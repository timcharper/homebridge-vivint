const dataPatch = require("../lib/datapatch.js")
const debounce = require("debounce-promise")
const extend = require('util')._extend
const VivintDict = require("./vivint_dictionary.json")

function serialNumber(ser, ser32) {
  return (ser32 || 0).toString(16).padStart(8, '0') + ':' +
    (ser || 0).toString(16).padStart(8, '0')
}

function DeviceSetModule(config, log, homebridge, vivintApi, ThermostatCharacteristics, setInterval, Date) {
  let PlatformAccessory = homebridge.platformAccessory;
  let Service = homebridge.hap.Service;
  let Accessory = homebridge.hap.Accessory;
  let Characteristic = homebridge.hap.Characteristic;
  let uuid = homebridge.hap.uuid;
  let temperatureUnits = (config.temperatureUnits || "f").toLowerCase()
  let config_LowBatteryLevel = parseInt(config.lowbatterylevel) || 10
  let config_IgnoredDeviceTypes = config.ignoreDeviceTypes || []

  let motionDetectedOccupancySensorMs = (config.motionDetectedOccupancySensorMins || 0) * 60 * 1000

  if (temperatureUnits != "c" && temperatureUnits != "f") {
    throw "config.temperatureUnits must be 'c' or 'f'; got this instead: " + temperatureUnits
  }

  class DeviceSet {
    constructor() {
      // deviceData = systemInfo.system.par[0].d
      this.lastSnapshotTime = 0
      this.devices = []
      this.devicesById = {}
      this.panel_Id = 0
    }

    bindAccessory(accessory) {
      let deviceClass = Devices.find((dc) => {
        return dc.name == accessory.context.deviceClassName
      })
      if (!deviceClass)
        throw "Unknown device class name " + accessory.context.deviceClassName

      let device = new deviceClass(accessory)
      this.devices.push(device)
      this.devicesById[device.id] = device

      if (accessory.context.deviceClassName === "Panel") this.panel_Id = device.id
    }

    handleSnapshot(deviceData, timestamp) {
      this.lastSnapshotTime = timestamp
      //log("Handling incoming device snapshot for timestamp", timestamp)

      // update armed status
      this.handleSecurity(deviceData.Status)

      for (let _deviceId in this.devicesById) {
        let deviceId = parseInt(_deviceId)
        let data = deviceData.Devices.find((dvc) => dvc.Id == deviceId)

        if (data) this.devicesById[_deviceId].handleSnapshot(data)
      }
    }

    handleMessage(message) {
      if (message.Data) {
        if (message.Data.PlatformContext.Timestamp < this.lastSnapshotTime) {
          log("Ignoring stale update", message.Data.PlatformContext.Timestamp, "<", this.lastSnapshotTime)
          return;
        }

        if (message.Data.Devices) {
          message.Data.Devices.forEach((patch) => {
            if (this.devicesById[patch.Id]) {
              this.devicesById[patch.Id].handlePatch(patch)
            }
          })
        //Arm
        } else if (message.Data.SecurityStateHistory_Armed) {
          this.handleSecurity(message.Data.SecurityStateHistory_Armed.Status)
        //Disarm
        } else if (message.Data.SecurityStateHistory_Disarmed) {
          this.handleSecurity(message.Data.SecurityStateHistory_Disarmed.Status)
        }
      }
    }

    handleSecurity(systemstate) {
      if (this.panel_Id && this.devicesById[this.panel_Id]) {

        let message = {
          Id: this.panel_Id,
          Status: systemstate
        }

        this.devicesById[this.panel_Id].handlePatch(message)
      }
    }
  }

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
      throw new("notify not implemented")
    }
  }

  extend(DeviceSet, {
    createDeviceAccessory: (data) => {
      let deviceClass = Devices.find((dc) => {
        return dc.appliesTo(data)
      })
      if (!deviceClass) {
        log("Unhandled device ID: " + data.Id + " Type: " + data.Type + " EquipmentCode: " + data.EquipmentCode + " Name: " + data.Name)
        return null
      }
      if (config_IgnoredDeviceTypes.indexOf(data.Type) != -1){
        log("Ignored device ID: " + data.Id + " Type: " + data.Type + " EquipmentCode: " + data.EquipmentCode + " Name: " + data.Name)
        return null
      }

      let name = data.Name
      let id = data.Id
      let serial = serialNumber(data.SerialNumber, data.SerialNumber32Bit)
      let category = deviceClass.inferCategory && deviceClass.inferCategory(data) || Accessory.Categories.OTHER

      let accessory = new PlatformAccessory(
        name,
        uuid.generate("Vivint:" + id + ":" + serial),
        category) // setting category doesn't seem to work :'(

      accessory.context.name = name
      accessory.context.id = data.Id
      accessory.context.deviceClassName = deviceClass.name


      let informationService = accessory.getServiceByUUIDAndSubType(Service.AccessoryInformation)

      informationService
        .setCharacteristic(Characteristic.Manufacturer, "Vivint")
        .setCharacteristic(Characteristic.Model, deviceClass.name)
        .setCharacteristic(Characteristic.SerialNumber, serial);

      deviceClass.addServices(accessory)
      return accessory
    }
  })

  class ContactSensor extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.ContactSensor)
      this.serviceb = accessory.getServiceByUUIDAndSubType(Service.BatteryService)

      this.service
        .getCharacteristic(Characteristic.ContactSensorState)
        .on('get', (next) => next(null, this.contactSensorValue()));

      if (this.serviceb) {
        this.serviceb
          .getCharacteristic(Characteristic.ChargingState)
          .updateValue(Characteristic.ChargingState.NOT_CHARGEABLE)
      }
    }

    contactSensorValue() {
      if (this.data.Status)
        return Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      else
        return Characteristic.ContactSensorState.CONTACT_DETECTED
    }

    contactBatteryLevelValue() {
      return this.data.BatteryLevel || 100
    }

    notify() {
      if (this.contactBatteryLevelValue() && this.serviceb) {
        if (0 <= this.contactBatteryLevelValue() && this.contactBatteryLevelValue() <= config_LowBatteryLevel) {
          this.serviceb.getCharacteristic(Characteristic.StatusLowBattery).updateValue(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
        } else this.serviceb.getCharacteristic(Characteristic.StatusLowBattery).updateValue(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)

        this.serviceb.getCharacteristic(Characteristic.BatteryLevel).updateValue(this.contactBatteryLevelValue())
      }

      this.service.getCharacteristic(Characteristic.ContactSensorState)
        .updateValue(this.contactSensorValue())
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

  class PIVMotion extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.MotionSensor)

      this.service
        .getCharacteristic(Characteristic.MotionDetected)
        .on('get', (next) => next(null, this.motionpivDetectedValue()))
    }

    motionpivDetectedValue() {
      return this.data.PersonInView || this.data.VisitorDetected
    }

    notify() {
      this.service.getCharacteristic(Characteristic.MotionDetected)
        .updateValue(this.motionpivDetectedValue())

      if (this.data.VisitorDetected) {
        // the doorbell uses the flag "VDT" and doesn't reset itself for some reason
        setTimeout(() => {
          this.service.getCharacteristic(Characteristic.MotionDetected).updateValue(0)
          this.data.VisitorDetected = 0
        }, 5000)
      }
      //log("Updated camera motion PIV: " + this.motionpivDetectedValue())
    }
  }
  extend(PIVMotion, {
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
      this.lastSensedMotion = null;
      this.service = accessory.getServiceByUUIDAndSubType(Service.MotionSensor)
      this.serviceb = accessory.getServiceByUUIDAndSubType(Service.BatteryService)
      this.occupancyService = accessory.getServiceByUUIDAndSubType(Service.OccupancySensor)

      this.service
        .getCharacteristic(Characteristic.MotionDetected)
        .on('get', (next) => next(null, this.motionDetectedValue()));

      if (this.occupancyService) {
        this.notifyOccupancy()
        this.occupancyService
          .getCharacteristic(Characteristic.OccupancyDetected)
          .on('get', (next) => next(null, this.occupancyValue()))

        setInterval(() => this.notifyOccupancy(), 60 * 1000);
      }
    }

    notifyOccupancy() {
      if (this.occupancyService) {
        this.occupancyService
          .getCharacteristic(Characteristic.OccupancyDetected)
          .updateValue(this.occupancyValue())
      }
    }

    occupancyValue() {
      if (this.lastSensedMotion == null)
        return Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
      let lastSensedDuration = Date.now() - this.lastSensedMotion
      if (lastSensedDuration < motionDetectedOccupancySensorMs)
        return Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
      else
        return Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
    }

    motionDetectedValue() {
      return this.data.Status
    }

    motionBatteryLevelValue() {
      return this.data.BatteryLevel || 100
    }

    notify() {
      if (this.motionDetectedValue()) {
        this.lastSensedMotion = Date.now()
      }

      if (this.motionBatteryLevelValue() && this.serviceb) {
        if (0 <= this.motionBatteryLevelValue() && this.motionBatteryLevelValue() <= config_LowBatteryLevel) {
          this.serviceb.getCharacteristic(Characteristic.StatusLowBattery).updateValue(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
        } else this.serviceb.getCharacteristic(Characteristic.StatusLowBattery).updateValue(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)

        this.serviceb.getCharacteristic(Characteristic.BatteryLevel).updateValue(this.motionBatteryLevelValue())
        this.serviceb.getCharacteristic(Characteristic.ChargingState).updateValue(Characteristic.ChargingState.NOT_CHARGEABLE)
      }

      this.service.getCharacteristic(Characteristic.MotionDetected)
        .updateValue(this.motionDetectedValue())
      this.notifyOccupancy()
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

      if (motionDetectedOccupancySensorMs > 0) {
        accessory.addService(new Service.OccupancySensor(accessory.context.name + " Occupancy"))
      }
    }
  })

  class Lock extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.LockMechanism)
      this.serviceb = accessory.getServiceByUUIDAndSubType(Service.BatteryService)

      this.service
        .getCharacteristic(Characteristic.LockCurrentState)
        .on('get', (next) => next(null, this.lockCurrentValue()));

      this.service
        .getCharacteristic(Characteristic.LockTargetState)
        .on('get', (next) => next(null, this.targetLockState || this.inferLockTargetState()))
        .on('set', this.setLockTargetStateCharacteristic.bind(this))

      if (this.serviceb) {
        this.serviceb
          .getCharacteristic(Characteristic.ChargingState)
          .updateValue(Characteristic.ChargingState.NOT_CHARGEABLE)
      }
    }

    inferLockTargetState() {
      if (this.data.Status)
        return Characteristic.LockTargetState.SECURED
      else
        return Characteristic.LockTargetState.UNSECURED
    }

    lockBatteryLevelValue() {
      return this.data.BatteryLevel || 100
    }

    setLockTargetStateCharacteristic(targetState, next) {
      let locked = (targetState == Characteristic.LockCurrentState.SECURED)
      this.targetLockState = targetState
      vivintApi.putDevice('locks', this.id, {
          id: this.id,
          s: locked
        })
        .then(
          (success) => next(),
          (failure) => {
            log("failure " + failure)
            next(failure)
          })
    }

    lockCurrentValue() {
      if (this.data.Status)
        return Characteristic.LockCurrentState.SECURED
      else
        return Characteristic.LockCurrentState.UNSECURED
    }

    notify() {
      this.targetLockState = this.inferLockTargetState()
      if (this.service) {
        this.service.getCharacteristic(Characteristic.LockCurrentState)
          .updateValue(this.lockCurrentValue())
        this.service.getCharacteristic(Characteristic.LockTargetState)
          .updateValue(this.targetLockState)
      }

      if (this.serviceb && this.lockBatteryLevelValue()) {
        if (0 <= this.lockBatteryLevelValue() && this.lockBatteryLevelValue() <= config_LowBatteryLevel) {
          this.serviceb.getCharacteristic(Characteristic.StatusLowBattery).updateValue(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
        } else this.serviceb.getCharacteristic(Characteristic.StatusLowBattery).updateValue(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)

        this.serviceb.getCharacteristic(Characteristic.BatteryLevel).updateValue(this.lockBatteryLevelValue())
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

      let self = this
      let getter = function(fn) {
        let bound = fn.bind(self)
        return (next) => {
          let result = bound()
          next(null, result)
        }
      }

      let promiseSetter = function(fn) {
        let boundDebounced = debounce(fn.bind(self), 250, {
          leading: true
        })
        return (value, next) => {
          boundDebounced(value).then(
            (result) => {
              next()
            },
            (failure) => {
              log("failure " + failure)
              next(failure)
            }
          )
        }
      }

      this.service
        .getCharacteristic(Characteristic.SecuritySystemCurrentState)
        .on('get', getter(this.getCurrentSecuritySystemState))

      this.service
        .getCharacteristic(Characteristic.SecuritySystemTargetState)
        .on('get', getter(this.getTargetSecuritySystemState))
        .on('set', promiseSetter(this.setTargetSecuritySystemState))
    }

    getTargetSecuritySystemState() {
      return this.getCurrentSecuritySystemState()
    }

    setTargetSecuritySystemState(targetState) {
      let vivintState = this.getVivintStateFromHomekitState(targetState)

      this.service
        .getCharacteristic(Characteristic.SecuritySystemTargetState)
        .updateValue(targetState)

      return vivintApi.putDevice('armedstates', null, {
        armState: vivintState,
        forceArm: false
      })
    }

    getCurrentSecuritySystemState() {
      return this.getHomekitStateFromVivintState(this.data.Status)
    }

    getHomekitStateFromVivintState(vivintState){
      switch(vivintState){
        case VivintDict.SecurityState.DISARMED:
          return Characteristic.SecuritySystemCurrentState.DISARMED
        case VivintDict.SecurityState.ARMED_STAY:
        case VivintDict.SecurityState.ARMED_STAY_IN_ENTRY_DELAY:
        case VivintDict.SecurityState.ARMING_STAY_IN_EXIT_DELAY:
          return Characteristic.SecuritySystemCurrentState.STAY_ARM
        case VivintDict.SecurityState.ARMED_AWAY:
        case VivintDict.SecurityState.ARMED_AWAY_IN_ENTRY_DELAY:
        case VivintDict.SecurityState.ARMING_AWAY_IN_EXIT_DELAY:
          return Characteristic.SecuritySystemCurrentState.AWAY_ARM
      }
    }

    getVivintStateFromHomekitState(homekitState){
      switch(homekitState){
        case Characteristic.SecuritySystemCurrentState.DISARMED:
          return VivintDict.SecurityState.DISARMED
        case Characteristic.SecuritySystemCurrentState.STAY_ARM:
        case Characteristic.SecuritySystemTargetState.NIGHT_ARM:
          return VivintDict.SecurityState.ARMED_STAY
        case Characteristic.SecuritySystemCurrentState.AWAY_ARM:
          return VivintDict.SecurityState.ARMED_AWAY
      }
    }

    notify() {
      this.service
        .getCharacteristic(Characteristic.SecuritySystemTargetState)
        .updateValue(this.getCurrentSecuritySystemState())

      this.service
        .getCharacteristic(Characteristic.SecuritySystemCurrentState)
        .updateValue(this.getCurrentSecuritySystemState())
    }
  }

  extend(Panel, {
    appliesTo: (data) => {
      return data.Type == VivintDict.PanelDeviceType.Panel
    },
    addServices: (accessory) => {
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
              log("failure " + failure)
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
              log("failure " + failure)
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
              log("failure " + failure)
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
              log("failure " + failure)
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
              log("failure " + failure)
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
              log("failure " + failure)
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
              log("failure " + failure)
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
            log("failure " + failure)
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
              log("failure " + failure)
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
        .getCharacteristic(ThermostatCharacteristics.HasLeaf)
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
      switch (this.Data.OperatingState) {
        case VivintDict.OperatingStates.IDLE:
          return Characteristic.CurrentHeatingCoolingState.OFF
        case VivintDict.OperatingStates.HEATING:
          return Characteristic.CurrentHeatingCoolingState.HEAT
        case VivintDict.OperatingStates.COOLING:
          return Characteristic.CurrentHeatingCoolingState.COOL
      }
    }

    getTargetHeatingCoolingState() {
      switch (this.Data.OperatingMode) {
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
      if (temperatureUnits == "f")
        return Characteristic.TemperatureDisplayUnits.FAHRENHEIT
      else
        return Characteristic.TemperatureDisplayUnits.CELSIUS
    }

    notify() {
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

  extend(Thermostat, {
    appliesTo: (data) => {
      return data.Type == VivintDict.PanelDeviceType.Thermostat
    },
    addServices: (accessory) => {
      accessory.addService(new Service.Thermostat(accessory.context.name))
      accessory.addService(new Service.Fan(accessory.context.name + " fan"))
    }
  })

  let Devices = [ContactSensor, MotionSensor, Lock, Thermostat, GarageDoor, Panel, PIVMotion, LightSwitch, DimmerSwitch]
  return DeviceSet
}

module.exports = DeviceSetModule
