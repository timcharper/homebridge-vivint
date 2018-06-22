const dataPatch = require("../lib/datapatch.js")
const debounce = require("debounce-promise")

function serialNumber(ser, ser32) {
  return (ser32 || 0).toString(16).padStart(8, '0') +
    (ser || 0).toString(16).padStart(8, '0')
}

function DeviceSetModule(config, log, homebridge, vivintApi, ThermostatCharacteristics, setInterval, Date) {
  let Accessory = homebridge.platformAccessory;
  let Service = homebridge.hap.Service;
  let Characteristic = homebridge.hap.Characteristic;
  let UUIDGen = homebridge.hap.uuid;
  let temperatureUnits = (config.temperatureUnits || "f").toLowerCase()

  let motionDetectedOccupancySensorMs = (config.motionDetectedOccupancySensorMins || 0) * 60 * 1000

  if (temperatureUnits != "c" && temperatureUnits != "f") {
    throw "config.temperatureUnits must be 'c' or 'f'; got this instead: " + temperatureUnits
  }

  class DeviceSet {
    constructor(deviceData, timestamp) {
      // deviceData = systemInfo.system.par[0].d
      this.lastSnapshotTime = timestamp
      this.devices = deviceData
        .map((d) => {
          let dv = Devices.find((device) => { return device.appliesTo(d) })
          if (dv)
            return new dv(d)
          else
            return null
        })
        .filter((d) => d != null)

      this.devicesById = {}
      this.devices.forEach((device) => {
        this.devicesById[device.id] = device
      })
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
    constructor(data) {
      this.data = data
      this.name = data.n
      this.id = data._id
      this.uuid_base = this.name + ":" + this.id + ":" + this.getSerialNumber
    }

    getType() {
      throw "not implemented"
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

    /**
     * Register device with HomeBridge, and associated accessors
     */
    getServices(next) {
      throw new("getServices not implemented")
    }

    getSerialNumber() {
      return serialNumber(this.data.ser, this.data.ser32)
    }

    notify() {
      throw new("notify not implemented")
    }
  }

  class DoorWindowSensor extends Device {
    getType() {
      return "DoorWindowSensor"
    }

    getServices() {
      this.informationService = new Service.AccessoryInformation();
      this.informationService
        .setCharacteristic(Characteristic.Manufacturer, "Vivint")
        .setCharacteristic(Characteristic.Model, this.getType())
        .setCharacteristic(Characteristic.SerialNumber, this.getSerialNumber());

      this.service = new Service.ContactSensor(this.name)

      this.service
        .getCharacteristic(Characteristic.ContactSensorState)
        .on('get', (next) => next(null, this.contactSensorValue()));

      this.notify()
      return [this.informationService, this.service];
    }

    contactSensorValue() {
      if (this.data.s)
        return Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      else
        return Characteristic.ContactSensorState.CONTACT_DETECTED
    }

    notify() {
      if (this.service)
        this.service.getCharacteristic(Characteristic.ContactSensorState)
          .updateValue(this.contactSensorValue())
    }
  }

  DoorWindowSensor.appliesTo = (data) => {
    return((data.t == "wireless_sensor") && ((data.ec == 1252) || (data.ec == 1251)))
  }


  class MotionSensor extends Device {
    constructor(data) {
      super(data)
      this.lastSensedMotion = null;
    }

    getType() {
      return "MotionSensor"
    }

    getServices() {
      this.informationService = new Service.AccessoryInformation();
      this.informationService
        .setCharacteristic(Characteristic.Manufacturer, "Vivint")
        .setCharacteristic(Characteristic.Model, this.getType())
        .setCharacteristic(Characteristic.SerialNumber, this.getSerialNumber());

      this.service = new Service.MotionSensor(this.name)

      this.service
        .getCharacteristic(Characteristic.MotionDetected)
        .on('get', (next) => next(null, this.motionDetectedValue()));

      let devices = [this.informationService, this.service]

      if (motionDetectedOccupancySensorMs > 0) {
        this.occupancyService = new Service.OccupancySensor(this.name + " Occupancy")
        this.occupancyService
          .getCharacteristic(Characteristic.OccupancyDetected)
          .on('get', (next) => next(null, this.occupancyValue()))

        setInterval(() => this.notifyOccupancy(), 60 * 1000);
        devices.push(this.occupancyService)
      }

      this.notify()
      return devices;
    }

    notifyOccupancy() {
      this.occupancyService
        .getCharacteristic(Characteristic.OccupancyDetected)
        .updateValue(this.occupancyValue())
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
      if (this.service) {
        if (this.motionDetectedValue()) {
          this.lastSensedMotion = Date.now()
          this.notifyOccupancy()
        }

        this.service.getCharacteristic(Characteristic.MotionDetected)
          .updateValue(this.motionDetectedValue())
      }
    }
  }

  MotionSensor.appliesTo = (data) => {
    return((data.t == "wireless_sensor") && ((data.ec == 1249) || (data.ec == 1249)))
  }

  class Lock extends Device {
    constructor(data) {
      super(data)
      this.targetLockState = this.inferLockTargetState()
    }
    getType() {
      return "Lock"
    }

    getServices() {
      this.informationService = new Service.AccessoryInformation();
      this.informationService
        .setCharacteristic(Characteristic.Manufacturer, "Vivint")
        .setCharacteristic(Characteristic.Model, this.getType())
        .setCharacteristic(Characteristic.SerialNumber, this.getSerialNumber());

      this.service = new Service.LockMechanism(this.name)

      this.service
        .getCharacteristic(Characteristic.LockCurrentState)
        .on('get', (next) => next(null, this.lockCurrentValue()));

      this.service
        .getCharacteristic(Characteristic.LockTargetState)
        .on('get', (next) => next(null, this.targetLockState))
        .on('set', this.setLockTargetStateCharacteristic.bind(this))

      this.notify()
      return [this.informationService, this.service];
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

  Lock.appliesTo = (data) => { return data.t == "door_lock_device" }

  class Thermostat extends Device {
    constructor(data) {
      super(data)
      console.log("Thermostat initialized")
      console.log(JSON.stringify(data))
    }
    getType() {
      return "Thermostat"
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

    getServices() {
      log("initialize services")
      this.informationService = new Service.AccessoryInformation();
      this.informationService
        .setCharacteristic(Characteristic.Manufacturer, "Vivint")
        .setCharacteristic(Characteristic.Model, this.getType())
        .setCharacteristic(Characteristic.SerialNumber, this.getSerialNumber());

      this.service = new Service.Thermostat(this.name)

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


      this.fanService = new Service.Fan(this.name + " fan")
        .setCharacteristic(Characteristic.Manufacturer, "Vivint")
        .setCharacteristic(Characteristic.Model, "Fan")
        .setCharacteristic(Characteristic.SerialNumber, this.getSerialNumber)

      this.fanService
        .getCharacteristic(Characteristic.On)
        .on('get', getter(this.getFanOn))
        .on('set', promiseSetter(this.setFanOn))

      this.notify()

      return [this.informationService, this.service, this.fanService];
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

  Thermostat.appliesTo = (data) => {
    return data.t == "thermostat_device"
  }

  let Devices = [DoorWindowSensor, MotionSensor, Lock, Thermostat]
  return DeviceSet
}

module.exports = DeviceSetModule
