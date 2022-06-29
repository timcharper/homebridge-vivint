const Device = require('../device.js')
const VivintDict = require("../vivint_dictionary.json")

class GarageDoor extends Device {
    constructor(accessory, data, config, log, homebridge, vivintApi) {
        super(accessory, data, config, log, homebridge, vivintApi)
      this.service = accessory.getService(this.Service.GarageDoorOpener)

      this.service
        .getCharacteristic(this.Characteristic.CurrentDoorState)
        .on('get', (callback) => callback(null, this.getGarageDoorCurrentState()));

      this.service
        .getCharacteristic(this.Characteristic.TargetDoorState)
        .on('get', (callback) => callback(null, this.getGarageDoorTargetState()))
        .on('set', async (state, callback) => this.setTargetState(state, callback))

      this.notify()
    }

    async setTargetState(targetState, callback) {
      let targetVivintState = targetState == this.Characteristic.TargetDoorState.CLOSED ? 
        VivintDict.GarageDoorStates.Closing : VivintDict.GarageDoorStates.Opening    
      try {
        callback()
        await this.vivintApi.setGarageDoorState(this.id, targetVivintState)
      }
      catch (err) {
        this.log.error("Failure setting garage door state:", err)
        callback(new Error(`An error occurred while setting the garage door state: ${err}`))
      }
    }

    getGarageDoorCurrentState() {
      switch(this.data.Status){
        case VivintDict.GarageDoorStates.Unknown: // unknown state but this eliminates double notification
        case VivintDict.GarageDoorStates.Closed:
          return this.Characteristic.CurrentDoorState.CLOSED

        case VivintDict.GarageDoorStates.Closing:
          return this.Characteristic.CurrentDoorState.CLOSING

        case VivintDict.GarageDoorStates.Opening:
          return this.Characteristic.CurrentDoorState.OPENING

        case VivintDict.GarageDoorStates.Opened:
          return this.Characteristic.CurrentDoorState.OPEN

        default:
          return this.Characteristic.CurrentDoorState.STOPPED
      }
    }

    getGarageDoorTargetState() {
      switch(this.data.Status){
        case VivintDict.GarageDoorStates.Opening:
        case VivintDict.GarageDoorStates.Opened:
          return this.Characteristic.TargetDoorState.OPEN

        case VivintDict.GarageDoorStates.Unknown: // unknown state but this eliminates double notification
        case VivintDict.GarageDoorStates.Closed:
        case VivintDict.GarageDoorStates.Closing:
        default:
          return this.Characteristic.TargetDoorState.CLOSED
      }
    }

    notify() {
      super.notify()
      if (this.service) {
        this.service.updateCharacteristic(this.Characteristic.CurrentDoorState, this.getGarageDoorCurrentState())
        this.service.updateCharacteristic(this.Characteristic.TargetDoorState, this.getGarageDoorTargetState())
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