const dataPatch = require("../lib/datapatch.js")
const debounce = require("debounce-promise")
const extend = require('util')._extend
const VivintDict = require("./vivint_dictionary.json")
const ThermostatCharacteristicsModule = require("../lib/thermostat_characteristics.js")

function DeviceSetModule(config, log, homebridge, vivintApi) {
  let PlatformAccessory = homebridge.platformAccessory;
  let Service = homebridge.hap.Service;
  let Accessory = homebridge.hap.Accessory;
  let Characteristic = homebridge.hap.Characteristic;
  let ThermostatCharacteristics = ThermostatCharacteristicsModule(homebridge)
  let uuid = homebridge.hap.uuid;

  let config_temperatureUnits = (config.temperatureUnits || "f").toLowerCase()
  let config_IgnoredDeviceTypes = config.ignoreDeviceTypes || []
  let config_showCameraConfig = config.showCameraConfig || false;
  let config_motionDetectedOccupancySensorMs = (config.motionDetectedOccupancySensorMins || 0) * 60 * 1000

  let config_debug = config.debug || 0

  if (config_temperatureUnits != "c" && config_temperatureUnits != "f") {
    throw "config.temperatureUnits must be 'c' or 'f'; got this instead: " + config_temperatureUnits
  }

  class DeviceSet {
    constructor() {
      this.lastSnapshotTime = 0
      this.devices = []
      this.devicesById = {}
      this.panel_DeviceId = 0
    }

    bindAccessory(accessory) {

      //This is required to maintain compatibility with the older plugin versions
      if (accessory.context.deviceClassName === "PIVMotion") {
        accessory.context.deviceClassName = "Camera"
      }

      let deviceClass = Devices.find((dc) => {
        return dc.name == accessory.context.deviceClassName
      })
      if (!deviceClass)
        throw "Unknown device class name " + accessory.context.deviceClassName

      let device = new deviceClass(accessory)
      this.devices.push(device)
      this.devicesById[device.id] = device

      if (accessory.context.deviceClassName === "Panel") this.panel_DeviceId = device.id
    }

    handleSnapshot(deviceData, timestamp) {
      this.lastSnapshotTime = timestamp
      if (this.config_debug) log.debug("Handling incoming device snapshot for timestamp", timestamp)

      //Move Security Status value to the Panel device
      let panelData = deviceData.Devices.find((dvc) => dvc.Id == this.panel_DeviceId)
      panelData.Status = deviceData.Status

      for (let _deviceId in this.devicesById) {             
        let deviceId = parseInt(_deviceId)
        let data = deviceData.Devices.find((dvc) => dvc.Id == deviceId)

        if (data) this.devicesById[_deviceId].handleSnapshot(data)
      }
    }

    handleMessage(message) {
      log.debug(message)
      if (message.Data) {
        if (message.Data.PlatformContext.Timestamp < this.lastSnapshotTime) {
          log.warn("Ignoring stale update", message.Data.PlatformContext.Timestamp, "<", this.lastSnapshotTime)
          return;
        }

        //Panel
        if (message.Id === vivintApi.panelId && message.Data.Status != undefined) {
          //Move Security Status value to the Panel device
          message.Data.Devices = [{
            Id: this.panel_DeviceId,
            Status: message.Data.Status
          }]
        }
        //Jammed lock notification
        else if (message.Type === VivintDict.ObjectType.InboxMessage && message.Data.Subject.indexOf('failed to lock') !== -1){
          const lockName = message.Data.Subject.split('Alert: ')[1].split(' failed to lock')[0]
          var lockDevice = this.devices.find(device => {
            return device.data.Type === VivintDict.PanelDeviceType.DoorLock && device.name === lockName
          })
          if (lockDevice) {
            message.Data.Devices = [{
              Id: lockDevice.data.Id,
              Status: Characteristic.LockCurrentState.JAMMED
            }]
          }
        }

        if (message.Data.Devices) {
          message.Data.Devices.forEach((patch) => {
            if (this.devicesById[patch.Id]) {
              this.devicesById[patch.Id].handlePatch(patch)
            }
          })
        }
      }
    }
  }
  extend(DeviceSet, {
    createDeviceAccessory: (data) => {
      let deviceClass = Devices.find((dc) => {
        return dc.appliesTo(data)
      })
      if (!deviceClass) {
        log.info(`Device not (yet) supported [ID]:${data.Id} [Type]:${data.Type} [EquipmentCode]:${data.EquipmentCode} [Name]:${data.Name}`)
        return null
      }
      if (config_IgnoredDeviceTypes.indexOf(data.Type) != -1){
        log.info(`Ignored device [ID]:${data.Id} [Type]:${data.Type} [EquipmentCode]:${data.EquipmentCode} [Name]:${data.Name}`)
        return null
      }

      let name = data.Name
      let id = data.Id

      let serial = (data.SerialNumber32Bit || 0).toString(16).padStart(8, '0') + ':' + (data.SerialNumber || 0).toString(16).padStart(8, '0')

      let category = deviceClass.inferCategory && deviceClass.inferCategory(data) || Accessory.Categories.OTHER

      var manufacturer = "Vivint"
      var model = data.EquipmentCode !== undefined ? vivintApi.getDictionaryKeyByValue(VivintDict.EquipmentCode, data.EquipmentCode) : deviceClass.name

      //For non-Vivint devices override values 
      if (data.ActualType) {
        let splittedName = data.ActualType.split('_')
        if (splittedName.length > 0) {
          manufacturer = splittedName[0].toUpperCase()
        }
        if (splittedName.length > 1) {
          model = splittedName[1].toUpperCase()
        }
      }

      let accessory = new PlatformAccessory(
        name,
        uuid.generate("Vivint:" + id + ":" + serial),
        category) // setting category doesn't seem to work :'(

      accessory.context.name = name
      accessory.context.id = data.Id
      accessory.context.deviceClassName = deviceClass.name

      let informationService = accessory.getServiceByUUIDAndSubType(Service.AccessoryInformation)
      informationService
        .setCharacteristic(Characteristic.Manufacturer, manufacturer)
        .setCharacteristic(Characteristic.Model, model)
        .setCharacteristic(Characteristic.SerialNumber, serial)

      if (data.CurrentSoftwareVersion || data.SoftwareVersion){
        informationService
          .setCharacteristic(Characteristic.FirmwareRevision, data.CurrentSoftwareVersion || data.SoftwareVersion)
      }

      deviceClass.addServices(accessory)

      //If "Show Camera Config" is enabled, show config for camera in log
      if (config_showCameraConfig == true && deviceClass.name === "Camera") {

        let source = data.CameraInternalURL[0].replace('rtsp://',`rtsp://${vivintApi.panelLogin.Name}:${vivintApi.panelLogin.Password}@`)

        var cameraConfigObject = {
          name: name,
          manufacturer: manufacturer,
          model: model,
          videoConfig: {
            source: `-rtsp_transport tcp -re -i ${source}`,
            vcodec: "copy",
            audio: true
          }
        }

        log.info(`Camera [${name}] configuration:`, JSON.stringify(cameraConfigObject, undefined, 4))
      }

      return accessory
    }
  })

  class Device {
    constructor(accessory) {
      this.id = accessory.context.id
      this.name = accessory.context.name
      this.data = {}
    }

    handleSnapshot(data) {
      if (data.Id != this.id)
        throw "This snapshot does not belong to this device"
      this.data = data
      this.notify()
    }

    /**
     * Handle a PubSub patch
     */
    handlePatch(patch) {
      if (patch.Id != this.id)
        throw "This patch does not belong to this device"

      dataPatch(this.data, patch)
      this.notify()
    }

    notify() {
      throw new("Notify method not implemented")
    }
  }

  class ContactSensor extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.ContactSensor)
      this.batteryService = accessory.getServiceByUUIDAndSubType(Service.BatteryService)
      
      this.batteryService.updateCharacteristic(Characteristic.ChargingState, Characteristic.ChargingState.NOT_CHARGEABLE)
      
      this.service
        .getCharacteristic(Characteristic.ContactSensorState)
        .on('get', async callback => this.getCurrentState(callback))

      this.notify()
    }

    getBatteryLevelValue() {
      return this.data.BatteryLevel || 100
    }

    isLowBattery() {
      return this.data.LowBattery || false
    }

    getSensorState() {
      if (this.data.Status)
        return Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      else
        return Characteristic.ContactSensorState.CONTACT_DETECTED
    }

    async getCurrentState(callback) {
      return callback(null, this.getSensorState())
    }

    notify() {
      if (this.service) {
        this.service.getCharacteristic(Characteristic.ContactSensorState)
          .updateValue(this.getSensorState())
      }

      if (this.batteryService) {
        this.batteryService
          .getCharacteristic(Characteristic.StatusLowBattery)
          .updateValue(this.isLowBattery() === true ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)

        this.batteryService.getCharacteristic(Characteristic.BatteryLevel).updateValue(this.getBatteryLevelValue())
      }
    }
  }
  extend(ContactSensor, {
    appliesTo: (data) => {
      return (
        (data.Type == VivintDict.PanelDeviceType.WirelessSensor) && 
        (
          (data.EquipmentCode == VivintDict.EquipmentCode.DW21R_RECESSED_DOOR) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.DW11_THIN_DOOR_WINDOW) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.EXISTING_DOOR_WINDOW_CONTACT) ||
          (data.EquipmentCode == VivintDict.EquipmentCode.TAKE_TAKEOVER) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.GB2_GLASS_BREAK) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.TILT_SENSOR_2GIG_345) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.VS_CO3_DETECTOR) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.VS_SMKT_SMOKE_DETECTOR) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.SMKT2_GE_SMOKE_HEAT) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.EXISTING_HEAT) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.EXISTING_FLOOD_TEMP) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.FIREFIGHTER_AUDIO_DETECTOR)
        ) 
      )
    },
    inferCategory: (data) => {
      let name = data.Name

      if (name.match(/\bwindow\b/i))
        return Accessory.Categories.WINDOW
      else if (name.match(/\bdoor(way)?\b/i))
        return Accessory.Categories.DOOR
      else
        return Accessory.Categories.OTHER
    },
    addServices: (accessory) => {
      accessory.addService(new Service.ContactSensor(accessory.context.name))
      accessory.addService(new Service.BatteryService(accessory.context.name))
    }
  })

  class Camera extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.MotionSensor)

      this.service
        .getCharacteristic(Characteristic.MotionDetected)
        .on('get', callback => callback(null, this.getMotionDetectedState()))

      this.notify()
    }

    getMotionDetectedState() {
      return this.data.PersonInView || this.data.VisitorDetected
    }

    notify() {
      if (this.service) {
        this.service.updateCharacteristic(Characteristic.MotionDetected, this.getMotionDetectedState())

        if (this.data.VisitorDetected) {
          // the doorbell uses the flag "VisitorDetected" and doesn't reset itself for some reason
          setTimeout(() => {
            this.service.updateCharacteristic(Characteristic.MotionDetected, 0)
            this.data.VisitorDetected = 0
          }, 5000)
        }
        log.debug("Updated camera motion PIV: " + this.getMotionDetectedState())
      }
    }
  }
  extend(Camera, {
    appliesTo: (data) => {
      return (data.Type == VivintDict.PanelDeviceType.Camera)
    },
    addServices: (accessory) => {
      accessory.addService(new Service.MotionSensor(accessory.context.name + " PIV Detector"))
    }
  })

  class MotionSensor extends Device {
    constructor(accessory) {
      super(accessory)
      this.lastSensedMotion = null; //TODO: Check how this variable is used and assigned

      this.service = accessory.getServiceByUUIDAndSubType(Service.MotionSensor)

      this.occupancyService = accessory.getServiceByUUIDAndSubType(Service.OccupancySensor)

      this.batteryService = accessory.getServiceByUUIDAndSubType(Service.BatteryService)
      this.batteryService.updateCharacteristic(Characteristic.ChargingState, Characteristic.ChargingState.NOT_CHARGEABLE)

      this.service
        .getCharacteristic(Characteristic.MotionDetected)
        .on('get', callback => callback(null, this.getMotionDetectedState()))

      this.notify()

      if (this.occupancyService) {
        this.notifyOccupancy()
        this.occupancyService
          .getCharacteristic(Characteristic.OccupancyDetected)
          .on('get', callback => callback(null, this.getOccupancyState()))

        setInterval(() => this.notifyOccupancy(), 60 * 1000)
      }
    }

    getBatteryLevelValue() {
      return this.data.BatteryLevel || 100
    }

    isLowBattery() {
      return this.data.LowBattery || false
    }

    getOccupancyState() {
      if (this.lastSensedMotion == null)
        return Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
      let lastSensedDuration = Date.now() - this.lastSensedMotion
      if (lastSensedDuration < config_motionDetectedOccupancySensorMs)
        return Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
      else
        return Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
    }

    getMotionDetectedState() {
      return this.data.Status
    }

    notifyOccupancy() {
      if (this.occupancyService) {
        this.occupancyService
          .getCharacteristic(Characteristic.OccupancyDetected)
          .updateValue(this.getOccupancyState())
      }
    }

    notify() {
      if (this.service) {
        this.service.updateCharacteristic(Characteristic.MotionDetected, this.getMotionDetectedState())
        this.notifyOccupancy()
      }

      if (this.batteryService) {
        this.batteryService
          .getCharacteristic(Characteristic.StatusLowBattery)
          .updateValue(this.isLowBattery() === true ? 
            Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : 
            Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)

        this.batteryService.updateCharacteristic(Characteristic.BatteryLevel, this.getBatteryLevelValue())
      }
    }
  }
  extend(MotionSensor, {
    appliesTo: (data) => {
      return (
        (data.Type ==  VivintDict.PanelDeviceType.WirelessSensor) && 
          (
            data.EquipmentCode == VivintDict.EquipmentCode.PIR2_MOTION || 
            data.EquipmentCode == VivintDict.EquipmentCode.EXISTING_MOTION_DETECTOR
          )
        )
    },
    addServices: (accessory) => {
      accessory.addService(new Service.MotionSensor(accessory.context.name))
      accessory.addService(new Service.BatteryService(accessory.context.name))

      if (config_motionDetectedOccupancySensorMs > 0) {
        accessory.addService(new Service.OccupancySensor(accessory.context.name + " Occupancy"))
      }
    }
  })

  class Lock extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.LockMechanism)
      this.batteryService = accessory.getServiceByUUIDAndSubType(Service.BatteryService)
      
      this.batteryService.updateCharacteristic(Characteristic.ChargingState, Characteristic.ChargingState.NOT_CHARGEABLE)

      this.service
        .getCharacteristic(Characteristic.LockCurrentState)
        .on('get', async callback => this.getCurrentState(callback))

      this.service
        .getCharacteristic(Characteristic.LockTargetState)
        .on('get', async callback => this.getTargetState(callback))
        .on('set', async (state, callback) => this.setTargetState(state, callback))

      this.notify()
    }

    getBatteryLevelValue() {
      return this.data.BatteryLevel || 100
    }

    isLowBattery() {
      return this.data.LowBattery || false
    }

    async setTargetState(targetState, callback) {
      let locked = (targetState == Characteristic.LockCurrentState.SECURED)     
      try {
        await vivintApi.setLockState(this.id, locked)
        callback(null)
      }
      catch (err) {
        log.error("Failure setting lock state:", err)
        callback(new Error(`An error occurred while setting the door lock state: ${err}`))
      }
    }

    async getTargetState(callback) {
      let state = this.service.getCharacteristic(Characteristic.LockTargetState);
      return callback(null, state)
    }

    async getCurrentState(callback) {
      return callback(null, this.getLockState())
    }

    getLockState() {
      switch (this.data.Status){
        case false:
          return Characteristic.LockCurrentState.UNSECURED
        case true:
          return Characteristic.LockCurrentState.SECURED
        case Characteristic.LockCurrentState.JAMMED:
          return Characteristic.LockCurrentState.JAMMED
      }
    }

    notify() {
      if (this.service) {
        let state = this.getLockState();
        this.service.updateCharacteristic(Characteristic.LockCurrentState, state);
        this.service.updateCharacteristic(Characteristic.LockTargetState, state == Characteristic.LockTargetState.SECURED);
      }

      if (this.batteryService) {
        this.batteryService.updateCharacteristic(Characteristic.StatusLowBattery, 
          this.isLowBattery() === true ? 
          Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
          Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)

        this.batteryService.updateCharacteristic(Characteristic.BatteryLevel, this.getBatteryLevelValue())
      }
    }
  }
  extend(Lock, {
    appliesTo: (data) => {
      return data.Type == VivintDict.PanelDeviceType.DoorLock
    },
    addServices: (accessory) => {
      accessory.addService(new Service.LockMechanism(accessory.context.name))
      accessory.addService(new Service.BatteryService(accessory.context.name))
    }
  })

  class Panel extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.SecuritySystem)

      this.VIVINT_TO_HOMEKIT = {
        [VivintDict.SecurityState.DISARMED]:                  Characteristic.SecuritySystemCurrentState.DISARMED,
        [VivintDict.SecurityState.ARMING_AWAY_IN_EXIT_DELAY]: Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        [VivintDict.SecurityState.ARMING_STAY_IN_EXIT_DELAY]: Characteristic.SecuritySystemCurrentState.STAY_ARM,
        [VivintDict.SecurityState.ARMED_STAY]:                Characteristic.SecuritySystemCurrentState.STAY_ARM,
        [VivintDict.SecurityState.ARMED_AWAY]:                Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        [VivintDict.SecurityState.ARMED_STAY_IN_ENTRY_DELAY]: Characteristic.SecuritySystemCurrentState.STAY_ARM,
        [VivintDict.SecurityState.ARMED_AWAY_IN_ENTRY_DELAY]: Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        [VivintDict.SecurityState.ALARM]:                     Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED,
        [VivintDict.SecurityState.ALARM_FIRE]:                Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED,
        [VivintDict.SecurityState.DISABLED]:                  Characteristic.SecuritySystemCurrentState.DISARMED,
        [VivintDict.SecurityState.WALK_TEST]:                 Characteristic.SecuritySystemCurrentState.DISARMED
      };

      this.HOMEKIT_TO_VIVINT = {
        [Characteristic.SecuritySystemTargetState.DISARM]: VivintDict.SecurityState.DISARMED,
        [Characteristic.SecuritySystemTargetState.STAY_ARM]: VivintDict.SecurityState.ARMED_STAY,
        [Characteristic.SecuritySystemTargetState.AWAY_ARM]: VivintDict.SecurityState.ARMED_AWAY
      };

      this.VALID_CURRENT_STATE_VALUES = [
        Characteristic.SecuritySystemCurrentState.STAY_ARM,
        Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        Characteristic.SecuritySystemCurrentState.DISARMED,
        Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
      ];

      this.VALID_TARGET_STATE_VALUES = [
          Characteristic.SecuritySystemTargetState.STAY_ARM,
          Characteristic.SecuritySystemTargetState.AWAY_ARM,
          Characteristic.SecuritySystemTargetState.DISARM
      ];

      this.service
        .getCharacteristic(Characteristic.SecuritySystemCurrentState)
        .setProps({ validValues: this.VALID_CURRENT_STATE_VALUES })
        .on('get', async callback => this.getCurrentState(callback))

      this.service
        .getCharacteristic(Characteristic.SecuritySystemTargetState)
        .setProps({ validValues: this.VALID_TARGET_STATE_VALUES })
        .on('get', async callback => this.getTargetState(callback))
        .on('set', async (state, callback) => this.setTargetState(state, callback))

      //this.notify()
    }

    getPanelState() {
      return this.VIVINT_TO_HOMEKIT[this.data.Status];
    }

    async getCurrentState(callback) {
      return callback(null, this.getPanelState())
    }

    async getTargetState(callback) {
      return callback(null, this.service.getCharacteristic(Characteristic.SecuritySystemTargetState));
    }

    async setTargetState(targetState, callback) {
      let vivintState = this.HOMEKIT_TO_VIVINT[targetState]   
      
      try {
        //Vivint does not support changing from Stay to Away and vice versa when armed so we need to disarm first
        if (targetState !== Characteristic.SecuritySystemTargetState.DISARM &&
          this.getPanelState() !== Characteristic.SecuritySystemCurrentState.DISARMED) {
            await vivintApi.setPanelState(this.HOMEKIT_TO_VIVINT[Characteristic.SecuritySystemTargetState.DISARM])
        }

        await vivintApi.setPanelState(vivintState)

        callback(null) 
      }
      catch (err) {
        log.error("Failure setting panel state:", err)
        callback(new Error(`An error occurred while setting the panel state: ${err}`))
      }
    }

    notify(){
      if (this.service) {
        let state = this.getPanelState()
        if (state !== undefined) {
          this.service
            .updateCharacteristic(Characteristic.SecuritySystemCurrentState, state)
            .updateCharacteristic(Characteristic.SecuritySystemTargetState, state) //TODO: Check how it behaves during alarm
        }
      }
    }
  }
  extend(Panel, {
    appliesTo: data => {
      return data.Type == VivintDict.PanelDeviceType.Panel
    },
    addServices: accessory => {
      accessory.addService(new Service.SecuritySystem(accessory.context.name))
    }
  })

  class GarageDoor extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.GarageDoorOpener)

      this.service
        .getCharacteristic(Characteristic.CurrentDoorState)
        .on('get', (next) => next(null, this.doorCurrentValue()));

      this.service
        .getCharacteristic(Characteristic.TargetDoorState)
        .on('get', (next) => next(null, this.doorCurrentValue()))
        .on('set', this.setDoorTargetStateCharacteristic.bind(this))
    }

    setDoorTargetStateCharacteristic(targetState, next) {
      if (targetState) {
        this.service
          .getCharacteristic(Characteristic.TargetDoorState)
          .updateValue(Characteristic.TargetDoorState.CLOSED)

        vivintApi.putDevice('door', this.id, {
            s: VivintDict.GarageDoorStates.Closing,
            _id: this.id
          })
          .then(
            (success) => next(),
            (failure) => {
              log.error("Failure setting garage door state:", failure)
              next(failure)
            })
      } else {
        this.service
          .getCharacteristic(Characteristic.TargetDoorState)
          .updateValue(Characteristic.TargetDoorState.OPEN)

        vivintApi.putDevice('door', this.id, {
            s: VivintDict.GarageDoorStates.Opening,
            _id: this.id
          })
          .then(
            (success) => next(),
            (failure) => {
              log.error("Failure setting garage door state:", failure)
              next(failure)
            })
      }
    }


    doorCurrentValue() {
      switch(this.data.Status){
        case VivintDict.GarageDoorStates.Unknown: // unknown state but this eliminates double notification
        case VivintDict.GarageDoorStates.Closed:
          return Characteristic.CurrentDoorState.CLOSED

        case VivintDict.GarageDoorStates.Closing:
          return Characteristic.CurrentDoorState.CLOSING

        case VivintDict.GarageDoorStates.Opening:
          return Characteristic.CurrentDoorState.OPENING

        case VivintDict.GarageDoorStates.Open:
          return Characteristic.CurrentDoorState.OPEN

        default:
          return Characteristic.CurrentDoorState.STOPPED
      }
    }

    notify() {
      if (this.service) {
        this.service.getCharacteristic(Characteristic.CurrentDoorState)
          .updateValue(this.doorCurrentValue())
      }
    }
  }
  extend(GarageDoor, {
    appliesTo: (data) => {
      return data.Type == VivintDict.PanelDeviceType.GarageDoor
    },
    addServices: (accessory) => {
      accessory.addService(new Service.GarageDoorOpener(accessory.context.name))
    }
  })

  // Binary switch has only on and off states
  class LightSwitch extends Device {
    constructor(accessory) {
      super(accessory)

      this.service = accessory.getServiceByUUIDAndSubType(Service.Lightbulb) || accessory.getServiceByUUIDAndSubType(Service.Fan) || accessory.getServiceByUUIDAndSubType(Service.Switch)

      this.service
        .getCharacteristic(Characteristic.On)
        .on('get', (next) => next(null, this.switchCurrentValue()))
        .on('set', this.setSwitchCurrentValue.bind(this))
    }

    switchCurrentValue() {
      return this.data.Status
    }

    setSwitchCurrentValue(targetState, next) {
      if (targetState) {
        // turn switch on
        vivintApi.putDevice('switches', this.id, {
            s: true,
            _id: this.id
          })
          .then(
            (success) => next(),
            (failure) => {
              log.error("Failure setting switch state:", failure)
              next(failure)
            })
      } else {
        // turn switch off
        vivintApi.putDevice('switches', this.id, {
            s: false,
            _id: this.id
          })
          .then(
            (success) => next(),
            (failure) => {
              log.error("Failure setting switch state:", failure)
              next(failure)
            })
      }
    }


    notify() {
      if (this.service) {
        if (this.data.Value == 0) {
          this.service
            .getCharacteristic(Characteristic.On)
            .updateValue(false)
        } else {
          this.service
            .getCharacteristic(Characteristic.On)
            .updateValue(true)
        }
      }
    }
  }
  extend(LightSwitch, {
    appliesTo: (data) => {
      return data.Type == VivintDict.PanelDeviceType.BinarySwitch
    },
    addServices: (accessory) => {
      if (accessory.context.name.match(/\blight\b/i)) {
        accessory.addService(new Service.Lightbulb(accessory.context.name))
      } else if (accessory.context.name.match(/\bfan\b/i)) {
        accessory.addService(new Service.Fan(accessory.context.name))
      } else {
        accessory.addService(new Service.Switch(accessory.context.name))
      }
    }
  })

  // dimmer switch {s: true/false, val: 0-100}
  // special note that vivint will always send TWO messages to the event stream
  // one with s: true/false and another with val:0-100. The val message comes first.
  class DimmerSwitch extends Device {
    constructor(accessory) {
      super(accessory)

      let self = this
      let promiseSetter = function(fn) {
        let boundDebounced = debounce(fn.bind(self), 500, {
          leading: true
        })
        return (value, next) => {
          boundDebounced(value).then(
            (result) => {
              next()
            },
            (failure) => {
              log.error("Failure setting dimmer switch state:", failure)
              next(failure)
            }
          )
        }
      }

      this.service = accessory.getServiceByUUIDAndSubType(Service.Lightbulb)

      this.service
        .getCharacteristic(Characteristic.On)
        .on('get', (next) => next(null, this.switchCurrentValue()))
        .on('set', this.setSwitchCurrentValue.bind(this))

      this.service
        .getCharacteristic(Characteristic.Brightness)
        .on('get', (next) => next(null, this.switchBrightnessValue()))
        .on('set', promiseSetter(this.setBrightnessValue.bind(this)))
        //.on('set', this.setBrightnessValue.bind(this))

      this.last_val_s = null
      this.last_val = null
    }

    switchCurrentValue() {
      return this.data.Status
    }

    setSwitchCurrentValue(targetState, next) {
      if (targetState) {
        // turn switch on
        vivintApi.putDevice('switches', this.id, {
            s: true,
            _id: this.id
          })
          .then(
            (success) => next(),
            (failure) => {
              log.error("Failure setting dimmer switch state:", failure)
              next(failure)
            })
      } else {
        // turn switch off
        vivintApi.putDevice('switches', this.id, {
            s: false,
            _id: this.id
          })
          .then(
            (success) => next(),
            (failure) => {
              log.error("Failure setting dimmer switch state:", failure)
              next(failure)
            })
      }
    }

    switchBrightnessValue() {
      return this.data.Value
    }

    setBrightnessValue(targetState, next) {
      vivintApi.putDevice('switches', this.id, {
          val: targetState,
          _id: this.id
        })
        .then(
          (success) => next(),
          (failure) => {
            log.error("Failure setting dimmer brightness state:", failure)
            next(failure)
          })
    }

    notify() {
      // vivint will typically send two notifications

      if (this.service) {
        if (this.data.Value !== this.last_val) {
          // dimmer level has changed, update HomeKit
          this.last_val = this.data.Value
          this.service
            .getCharacteristic(Characteristic.Brightness)
            .updateValue(this.data.Value)
        }

        if (this.data.Status !== this.last_val_s) {
          // on/off state has changed, update HomeKit
          this.last_val_s = this.data.Status
          this.service
            .getCharacteristic(Characteristic.On)
            .updateValue(this.switchCurrentValue())
        }
      }
    }
  }
  extend(DimmerSwitch, {
    appliesTo: (data) => {
      return data.Type == VivintDict.PanelDeviceType.MultiLevelSwitch
    },
    addServices: (accessory) => {
      //assuming this is a dimmer switch controlling a light
      accessory.addService(new Service.Lightbulb(accessory.context.name))
    }
  })

  class Thermostat extends Device {
    constructor(accessory) {
      super(accessory)

      this.ThermostatCharacteristics = ThermostatCharacteristicsModule(homebridge)
      
      this.service = accessory.getServiceByUUIDAndSubType(Service.Thermostat)
      this.fanService = accessory.getServiceByUUIDAndSubType(Service.Fan)

      let self = this
      let getter = function(fn) {
        let bound = fn.bind(self)
        return (next) => {
          let result = bound()
          next(null, result)
        }
      }

      let promiseSetter = function(fn) {
        let boundDebounced = debounce(fn.bind(self), 5000, {
          leading: true
        })
        return (value, next) => {
          boundDebounced(value).then(
            (result) => {
              next()
            },
            (failure) => {
              log.error("Failure setting thermostat state:", failure)
              next(failure)
            }
          )
        }
      }

      this.service
        .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .on('get', getter(this.getCurrentHeatingCoolingState))

      this.service
        .getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .on('get', getter(this.getTargetHeatingCoolingState))
        .on('set', promiseSetter(this.setTargetHeatingCoolingState))

      this.service
        .getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', getter(this.getCurrentTemperature))

      this.service
        .getCharacteristic(Characteristic.TargetTemperature)
        .on('get', getter(this.getTargetTemperature))
        .on('set', promiseSetter(this.setTargetTemperature))

      this.service
        .getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .on('get', getter(this.getCurrentRelativeHumidity))

      this.service
        .getCharacteristic(Characteristic.CoolingThresholdTemperature)
        .on('get', getter(this.getCoolingThresholdTemperature))
        .on('set', promiseSetter(this.setCoolingThresholdTemperature))

      this.service
        .getCharacteristic(Characteristic.HeatingThresholdTemperature)
        .on('get', getter(this.getHeatingThresholdTemperature))
        .on('set', promiseSetter(this.setHeatingThresholdTemperature))

      this.service
        .getCharacteristic(this.ThermostatCharacteristics.HasLeaf)
        .on('get', getter(this.getHasLeaf))

      this.service
        .getCharacteristic(Characteristic.TemperatureDisplayUnits)
        .on('get', getter(this.getTemperatureDisplayUnits))


      this.fanService
        .getCharacteristic(Characteristic.On)
        .on('get', getter(this.getFanOn))
        .on('set', promiseSetter(this.setFanOn))
    }

    getCurrentHeatingCoolingState() {
      switch (this.data.OperatingState) {
        case VivintDict.OperatingStates.IDLE:
          return Characteristic.CurrentHeatingCoolingState.OFF
        case VivintDict.OperatingStates.HEATING:
          return Characteristic.CurrentHeatingCoolingState.HEAT
        case VivintDict.OperatingStates.COOLING:
          return Characteristic.CurrentHeatingCoolingState.COOL
      }
    }

    getTargetHeatingCoolingState() {
      switch (this.data.OperatingMode) {
        case VivintDict.OperatingModes.OFF:
          return Characteristic.TargetHeatingCoolingState.OFF
        case VivintDict.OperatingModes.HEAT:
          return Characteristic.TargetHeatingCoolingState.HEAT
        case VivintDict.OperatingModes.COOL:
          return Characteristic.TargetHeatingCoolingState.COOL
        case VivintDict.OperatingModes.AUTO:
          return Characteristic.TargetHeatingCoolingState.AUTO
        case VivintDict.OperatingModes.ECO:
          return Characteristic.TargetHeatingCoolingState.AUTO // eco mode
      }
    }

    setTargetHeatingCoolingState(state) {
      var setValue = 0

      switch (state) {
        case Characteristic.TargetHeatingCoolingState.OFF:
          setValue = VivintDict.OperatingModes.OFF;
          break
        case Characteristic.TargetHeatingCoolingState.HEAT:
          setValue = VivintDict.OperatingModes.HEAT;
          break
        case Characteristic.TargetHeatingCoolingState.COOL:
          setValue = VivintDict.OperatingModes.COOL;
          break
        case Characteristic.TargetHeatingCoolingState.AUTO:
          setValue = VivintDict.OperatingModes.AUTO;
          break
      }

      return vivintApi.putDevice('thermostats', this.id, {
        _id: this.id,
        om: setValue
      })
    }

    getCurrentTemperature() {
      return this.data.Value
    }

    getTargetTemperature() {
      switch (this.getTargetHeatingCoolingState()) {
        case Characteristic.TargetHeatingCoolingState.OFF:
          return this.getCurrentTemperature()
        case Characteristic.TargetHeatingCoolingState.HEAT:
          return this.getHeatingThresholdTemperature()
        case Characteristic.TargetHeatingCoolingState.COOL:
          return this.getCoolingThresholdTemperature()
        case Characteristic.TargetHeatingCoolingState.AUTO:
          return this.getCurrentTemperature()
      }
    }
    setTargetTemperature(temperature) {
      switch (this.getTargetHeatingCoolingState()) {
        case Characteristic.TargetHeatingCoolingState.OFF:
          return Promise.reject("Can't set target temperature when thermostat is off")
        case Characteristic.TargetHeatingCoolingState.HEAT:
          return vivintApi.putDevice('thermostats', this.id, {
            _id: this.id,
            hsp: temperature,
            currentAutoMode: 1
          })
        case Characteristic.TargetHeatingCoolingState.COOL:
          return vivintApi.putDevice('thermostats', this.id, {
            _id: this.id,
            csp: temperature,
            currentAutoMode: 2
          })
        case Characteristic.TargetHeatingCoolingState.AUTO:
          return Promise.reject("Can't set target temperature in auto mode")
      }
    }

    getCoolingThresholdTemperature() {
      return this.data.CoolSetPoint;
    }

    setCoolingThresholdTemperature(value) {
      return vivintApi.putDevice('thermostats', this.id, {
        _id: this.id,
        csp: value
      })
    }

    getHeatingThresholdTemperature() {
      return this.data.HeatSetPoint;
    }

    setHeatingThresholdTemperature(value) {
      return vivintApi.putDevice('thermostats', this.id, {
        _id: this.id,
        hsp: value
      })
    }

    getCurrentRelativeHumidity() {
      return this.data.Humidity
    }

    getHasLeaf() {
      return this.data.OperatingMode == 100
    }

    getFanOn() {
      return this.data.FanState == 1
    }

    setFanOn(fanOn) {
      let setValue = fanOn ? 100 : 0
      return vivintApi.putDevice('thermostats', this.id, {
        _id: this.id,
        fm: setValue
      })
    }

    getTemperatureDisplayUnits() {
      if (config_temperatureUnits == "f")
        return Characteristic.TemperatureDisplayUnits.FAHRENHEIT
      else
        return Characteristic.TemperatureDisplayUnits.CELSIUS
    }

    notify() {
      if (this.service) {
        this.service
          .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
          .updateValue(this.getCurrentHeatingCoolingState())

        this.service
          .getCharacteristic(Characteristic.TargetHeatingCoolingState)
          .updateValue(this.getTargetHeatingCoolingState())

        this.service
          .getCharacteristic(Characteristic.CurrentTemperature)
          .updateValue(this.getCurrentTemperature())

        this.service
          .getCharacteristic(Characteristic.TargetTemperature)
          .updateValue(this.getTargetTemperature())

        this.service
          .getCharacteristic(Characteristic.CurrentRelativeHumidity)
          .updateValue(this.getCurrentRelativeHumidity())

        this.service
          .getCharacteristic(Characteristic.CoolingThresholdTemperature)
          .updateValue(this.getCoolingThresholdTemperature())

        this.service
          .getCharacteristic(Characteristic.HeatingThresholdTemperature)
          .updateValue(this.getHeatingThresholdTemperature())

        this.service
          .getCharacteristic(ThermostatCharacteristics.HasLeaf)
          .updateValue(this.getHasLeaf())

        this.service
          .getCharacteristic(Characteristic.TemperatureDisplayUnits)
          .updateValue(this.getTemperatureDisplayUnits())

        this.fanService
          .getCharacteristic(Characteristic.On)
          .updateValue(this.getFanOn())
      }
    }
  }
  extend(Thermostat, {
    appliesTo: (data) => {
      return data.Type == VivintDict.PanelDeviceType.Thermostat
    },
    addServices: (accessory) => {
      accessory.addService(new Service.Thermostat(accessory.context.name))
      accessory.addService(new Service.Fan(accessory.context.name + " fan"))
    }
  })

  let Devices = [ContactSensor, MotionSensor, Lock, Thermostat, GarageDoor, Panel, Camera, LightSwitch, DimmerSwitch]
  return DeviceSet
}

module.exports = DeviceSetModule
