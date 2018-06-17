const dataPatch = require("../lib/datapatch.js")

function serialNumber(ser, ser32) {
  return (ser32 || 0).toString(16).padStart(8, '0') +
    (ser || 0).toString(16).padStart(8, '0')
}

function DeviceSetModule(config, log, homebridge, vivintApi) {
  let Accessory = homebridge.platformAccessory;
  let Service = homebridge.hap.Service;
  let Characteristic = homebridge.hap.Characteristic;
  let UUIDGen = homebridge.hap.uuid;

  class DeviceSet {
    constructor(deviceData) {
      // deviceData = systemInfo.system.par[0].d
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

    handleMessage(msg) {
      if ((msg.message.da) && (msg.message.da.d)) {
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

    /**
     * Handle a PubSub patch
     */
    handlePatch(patch) {
      if (patch._id != this.data._id)
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
      let informationService = new Service.AccessoryInformation();
      informationService
        .setCharacteristic(Characteristic.Manufacturer, "Vivint")
        .setCharacteristic(Characteristic.Model, this.getType())
        .setCharacteristic(Characteristic.SerialNumber, this.getSerialNumber());

      this.service = new Service.ContactSensor(this.name)

      this.service
        .getCharacteristic(Characteristic.ContactSensorState)
        .on('get', (next) => next(null, this.contactSensorValue()));

      this.informationService = informationService;
      return [informationService, this.service];
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

  class Lock extends Device {
    constructor(data) {
      super(data)
      this.targetLockState = this.inferLockTargetState()
    }
    getType() {
      return "Lock"
    }

    getServices() {
      log("getServices lock")
      let informationService = new Service.AccessoryInformation();
      informationService
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

      this.informationService = informationService;
      return [informationService, this.service];
    }

    inferLockTargetState() {
      if (this.data.s)
        Characteristic.LockTargetState.SECURED
      else
        Characteristic.LockTargetState.UNSECURED
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

  let Devices = [DoorWindowSensor, Lock]
  return DeviceSet
}

module.exports = DeviceSetModule
