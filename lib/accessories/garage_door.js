const Device = require('../device.js')
const VivintDict = require("../vivint_dictionary.json")

class GarageDoor extends Device {
    constructor(accessory, data, config, log, homebridge, vivintApi) {
        super(accessory, data, config, log, homebridge, vivintApi)
      this.service = accessory.getService(this.Service.GarageDoorOpener)

      this.service
        .getCharacteristic(this.Characteristic.CurrentDoorState)
        .on('get', (next) => next(null, this.doorCurrentValue()));

      this.service
        .getCharacteristic(this.Characteristic.TargetDoorState)
        .on('get', (next) => next(null, this.doorCurrentValue()))
        .on('set', this.setDoorTargetStateCharacteristic.bind(this))
    }

    //TODO: refactor this
    setDoorTargetStateCharacteristic(targetState, next) {
      if (targetState) {
        this.service
          .getCharacteristic(this.Characteristic.TargetDoorState)
          .updateValue(this.Characteristic.TargetDoorState.CLOSED)

        this.vivintApi.putDevice('door', this.id, {
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
          .getCharacteristic(this.Characteristic.TargetDoorState)
          .updateValue(this.Characteristic.TargetDoorState.OPEN)

        this.vivintApi.putDevice('door', this.id, {
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
          return this.Characteristic.CurrentDoorState.CLOSED

        case VivintDict.GarageDoorStates.Closing:
          return this.Characteristic.CurrentDoorState.CLOSING

        case VivintDict.GarageDoorStates.Opening:
          return this.Characteristic.CurrentDoorState.OPENING

        case VivintDict.GarageDoorStates.Open:
          return this.Characteristic.CurrentDoorState.OPEN

        default:
          return this.Characteristic.CurrentDoorState.STOPPED
      }
    }

    notify() {
      super.notify()
      if (this.service) {
        this.service.getCharacteristic(this.Characteristic.CurrentDoorState)
          .updateValue(this.doorCurrentValue())
      }
    }

    static appliesTo(data) {
      return data.Type == VivintDict.PanelDeviceType.GarageDoor
    }

    static inferCategory(data, Accessory) {
      return Accessory.Categories.GARAGE_DOOR_OPENER
    }

    static addServices(accessory, Service) {
      accessory.addService(new Service.GarageDoorOpener(accessory.context.name))
    }
  }

module.exports = GarageDoor