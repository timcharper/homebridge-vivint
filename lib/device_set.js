const dataPatch = require("../lib/datapatch.js")

function serialNumber(ser, ser32) {
  return (ser32 || 0).toString(16).padStart(8, '0') +
    (ser || 0).toString(16).padStart(8, '0')
}

function DeviceSetModule(config, log, homebridge, vivint) {
  let Accessory = homebridge.platformAccessory;
  let Service = homebridge.hap.Service;
  let Characteristic = homebridge.hap.Characteristic;

  class DeviceSet {
    constructor(deviceData) {
      // deviceData = systemInfo.system.par[0].d
      this.devices = deviceData
        .map((d) => {
          let dv = Devices.find((device) => { return DoorWindowSensor.appliesTo(d) })
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
        .on('get', this.getContactSensorStateCharacteristic.bind(this));

      this.informationService = informationService;
      return [informationService, this.service];
    }

    getContactSensorStateCharacteristic(next) {
      next(null, this.contactSensorValue());
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

  DoorWindowSensor.appliesTo = function(data) {
    return((data.t == "wireless_sensor") && ((data.ec == 1252) || (data.ec == 1251)))
  }

  let Devices = [DoorWindowSensor]
  return DeviceSet
}

module.exports = DeviceSetModule
