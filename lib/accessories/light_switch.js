const Device = require('../device.js')
const VivintDict = require("../vivint_dictionary.json")

class LightSwitch extends Device {
  constructor(accessory, data, config, log, homebridge, vivintApi) {
    super(accessory, data, config, log, homebridge, vivintApi)

      this.service = accessory.getService(this.Service.Lightbulb) || accessory.getService(this.Service.Fan) || accessory.getService(this.Service.Switch)

      this.service
        .getCharacteristic(this.Characteristic.On)
        .on('get', (next) => next(null, this.switchCurrentValue()))
        .on('set', this.setSwitchCurrentValue.bind(this))
    }

    switchCurrentValue() {
      return this.data.Status
    }

    setSwitchCurrentValue(targetState, next) {
      if (targetState) {
        // turn switch on
        this.vivintApi.putDevice('switches', this.id, {
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
        this.vivintApi.putDevice('switches', this.id, {
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
            .getCharacteristic(this.Characteristic.On)
            .updateValue(false)
        } else {
          this.service
            .getCharacteristic(this.Characteristic.On)
            .updateValue(true)
        }
      }
    }

    static appliesTo(data) {
      return data.Type == VivintDict.PanelDeviceType.BinarySwitch
    }

    static inferCategory(data, Accessory) {
      return Accessory.Categories.SWITCH
    }

    static addServices(accessory, Service) {
      if (accessory.context.name.match(/\blight\b/i)) {
        accessory.addService(new Service.Lightbulb(accessory.context.name))
      } else if (accessory.context.name.match(/\bfan\b/i)) {
        accessory.addService(new Service.Fan(accessory.context.name))
      } else {
        accessory.addService(new Service.Switch(accessory.context.name))
      }
    }
  }

module.exports = LightSwitch