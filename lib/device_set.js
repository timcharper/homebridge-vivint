const dataPatch = require("../lib/datapatch.js")
const debounce = require("debounce-promise")
const extend = require('util')._extend

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
    }

    bindAccessory(accessory) {
      let deviceClass = Devices.find((dc) => { return dc.name == accessory.context.deviceClassName })
      if (!deviceClass)
        throw "Unknown device class name " + accessory.context.deviceClassName

      let device = new deviceClass(accessory)
      this.devices.push(device)
      this.devicesById[device.id] = device
    }

    handleSnapshot(deviceData, timestamp) {
      this.lastSnapshotTime = timestamp
      log("Handling incoming device snapshot for timestamp", timestamp)
      for (let _deviceId in this.devicesById) {
        let deviceId = parseInt(_deviceId)
        let d = deviceData.find((dvc) => dvc._id == deviceId)
        if (d) this.devicesById[_deviceId].handleSnapshot(d)
      }
    }

    handleMessage(msg) {
      if ((msg.message.da) && (msg.message.da.d)) {
        if (msg.message.da.plctx.ts < this.lastSnapshotTime) {
          log("Ignoring stale update", msg.message.da.plctx.ts, "<", this.lastSnapshotTime)
          return;
        }
        msg.message.da.d.forEach((patch) => {
          if (this.devicesById[patch._id]) {
            this.devicesById[patch._id].handlePatch(patch)
          }
        })
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
      if (data._id != this.id)
        throw "This snapshot does not belong to this device"
      this.data = data
      this.notify()
    }

    /**
     * Handle a PubSub patch
     */
    handlePatch(patch) {
      if (patch._id != this.id)
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
      let deviceClass = Devices.find((dc) => { return dc.appliesTo(data) })
      if (!deviceClass)
        return null // we don't know how to handle this device.

      let name = data.n
      let id = data._id
      let serial = serialNumber(data.ser, data.ser32)
      let category = deviceClass.inferCategory && deviceClass.inferCategory(data) || Accessory.Categories.OTHER

      let accessory = new PlatformAccessory(
        name,
        uuid.generate("Vivint:" + id + ":" + serial),
        category) // setting category doesn't seem to work :'(

      accessory.context.name = name
      accessory.context.id = data._id
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

      this.service
        .getCharacteristic(Characteristic.ContactSensorState)
        .on('get', (next) => next(null, this.contactSensorValue()));
    }

    contactSensorValue() {
      if (this.data.s)
        return Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      else
        return Characteristic.ContactSensorState.CONTACT_DETECTED
    }

    notify() {
      this.service.getCharacteristic(Characteristic.ContactSensorState)
        .updateValue(this.contactSensorValue())
    }
  }

  extend(ContactSensor, {
    appliesTo: (data) => {
      return((data.t == "wireless_sensor") && ((data.ec == 1252) || (data.ec == 1251)))
    },
    inferCategory: (data) => {
      let name = data.n
      if (name.match(/\bwindow\b/i))
        return Accessory.Categories.WINDOW
      else if (name.match(/\bdoor(way)?\b/i))
        return Accessory.Categories.DOOR
      else
        return Accessory.Categories.OTHER
    },
    addServices: (accessory) => {
      accessory.addService(new Service.ContactSensor(accessory.context.name))
    }
  })

  class MotionSensor extends Device {
    constructor(accessory) {
      super(accessory)
      this.lastSensedMotion = null;
      this.service = accessory.getServiceByUUIDAndSubType(Service.MotionSensor)
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
      return this.data.s
    }

    notify() {
      if (this.motionDetectedValue()) {
        this.lastSensedMotion = Date.now()
      }

      this.service.getCharacteristic(Characteristic.MotionDetected)
        .updateValue(this.motionDetectedValue())
      this.notifyOccupancy()
    }
  }
  extend(MotionSensor, {
    appliesTo: (data) => {
      return((data.t == "wireless_sensor") && ((data.ec == 1249) || (data.ec == 1249)))
    },
    addServices: (accessory) => {
      accessory.addService(new Service.MotionSensor(accessory.context.name))

      if (motionDetectedOccupancySensorMs > 0) {
        accessory.addService(new Service.OccupancySensor(accessory.context.name + " Occupancy"))
      }
    }
  })

  class Lock extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.LockMechanism)

      this.service
        .getCharacteristic(Characteristic.LockCurrentState)
        .on('get', (next) => next(null, this.lockCurrentValue()));

      this.service
        .getCharacteristic(Characteristic.LockTargetState)
        .on('get', (next) => next(null, this.targetLockState || this.inferLockTargetState()))
        .on('set', this.setLockTargetStateCharacteristic.bind(this))
    }

    inferLockTargetState() {
      if (this.data.s)
        return Characteristic.LockTargetState.SECURED
      else
        return Characteristic.LockTargetState.UNSECURED
    }

    setLockTargetStateCharacteristic(targetState, next) {
      let locked = (targetState == Characteristic.LockCurrentState.SECURED)
      this.targetLockState = targetState
      vivintApi.putDevice('locks', this.id, {id: this.id, s: locked})
        .then(
          (success) => next(),
          (failure) => {
            log("failure " + failure)
            next(failure)
          })
    }

    lockCurrentValue() {
      if (this.data.s)
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
    }
  }

  extend(Lock, {
    appliesTo: (data) => { return data.t == "door_lock_device" },
    addServices: (accessory) => {
      accessory.addService(new Service.LockMechanism(accessory.context.name))
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
        let boundDebounced = debounce(fn.bind(self), 5000, {leading: true})
        return (value, next) => {
          log("starting fn call value " + fn.name)
          boundDebounced(value).then(
            (result) => {
              log("got success value " + fn.name + " " + result)
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
      switch (this.data.os) {
      case 0: return Characteristic.CurrentHeatingCoolingState.OFF
      case 1: return Characteristic.CurrentHeatingCoolingState.HEAT
      case 2: return Characteristic.CurrentHeatingCoolingState.COOL
      }
    }

    getTargetHeatingCoolingState() {
      switch (this.data.om) {
        case 0: return Characteristic.TargetHeatingCoolingState.OFF
        case 1: return Characteristic.TargetHeatingCoolingState.HEAT
        case 2: return Characteristic.TargetHeatingCoolingState.COOL
        case 3: return Characteristic.TargetHeatingCoolingState.AUTO
        case 100: return Characteristic.TargetHeatingCoolingState.AUTO // eco mode
      }
    }

    setTargetHeatingCoolingState(state) {
      var setValue = 0

      switch (state) {
      case Characteristic.TargetHeatingCoolingState.OFF:  setValue = 0; break
      case Characteristic.TargetHeatingCoolingState.HEAT: setValue = 1; break
      case Characteristic.TargetHeatingCoolingState.COOL: setValue = 2; break
      case Characteristic.TargetHeatingCoolingState.AUTO: setValue = 3; break
      }

      return vivintApi.putDevice('thermostats', this.id, {_id: this.id, om: setValue})
    }

    getCurrentTemperature() {
      return this.data.val
    }

    getTargetTemperature() {
      switch (this.getTargetHeatingCoolingState()) {
      case Characteristic.TargetHeatingCoolingState.OFF: return this.getCurrentTemperature()
      case Characteristic.TargetHeatingCoolingState.HEAT: return this.getHeatingThresholdTemperature()
      case Characteristic.TargetHeatingCoolingState.COOL: return this.getCoolingThresholdTemperature()
      case Characteristic.TargetHeatingCoolingState.AUTO: return this.getCurrentTemperature()
      }
    }
    setTargetTemperature(temperature) {
      switch (this.getTargetHeatingCoolingState()) {
      case Characteristic.TargetHeatingCoolingState.OFF: return Promise.reject("Can't set target temperature when thermostat is off")
      case Characteristic.TargetHeatingCoolingState.HEAT:
        return vivintApi.putDevice('thermostats', this.id, {_id: this.id, hsp: temperature, currentAutoMode: 1})
      case Characteristic.TargetHeatingCoolingState.COOL:
        return vivintApi.putDevice('thermostats', this.id, {_id: this.id, csp: temperature, currentAutoMode: 2})
      case Characteristic.TargetHeatingCoolingState.AUTO: return Promise.reject("Can't set target temperature in auto mode")
      }
    }

    getCoolingThresholdTemperature() {
      return this.data.csp;
    }

    setCoolingThresholdTemperature(value) {
      return vivintApi.putDevice('thermostats', this.id, {_id: this.id, csp: value})
    }

    getHeatingThresholdTemperature() {
      return this.data.hsp;
    }

    setHeatingThresholdTemperature(value) {
      return vivintApi.putDevice('thermostats', this.id, {_id: this.id, hsp: value})
    }

    getCurrentRelativeHumidity() {
      return this.data.hmdt
    }

    getHasLeaf() {
      return this.data.om == 100
    }

    getFanOn() {
      return this.data.fs == 1
    }

    setFanOn(fanOn) {
      let setValue = fanOn ? 100 : 0
      return vivintApi.putDevice('thermostats', this.id, {_id: this.id, fm: setValue})
    }

    getTemperatureDisplayUnits () {
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

    /**
     * Handle a PubSub patch
     */
    handlePatch(patch) {
      console.log("==================")
      console.log("incoming patch")
      console.log(JSON.stringify(patch))
      console.log("state before")
      console.log(JSON.stringify(this.data))
      super.handlePatch(patch)
      console.log("state after")
      console.log(JSON.stringify(this.data))
    }
  }

  extend(Thermostat, {
    appliesTo: (data) => {
      return data.t == "thermostat_device"
    },
    addServices: (accessory) => {
      accessory.addService(new Service.Thermostat(accessory.context.name))
      accessory.addService(new Service.Fan(accessory.context.name + " fan"))
    }
  })

  let Devices = [ContactSensor, MotionSensor, Lock, Thermostat]
  return DeviceSet
}

module.exports = DeviceSetModule
