const Device = require('../device.js')
const VivintDict = require("../vivint_dictionary.json")

class Lock extends Device {
    constructor(accessory, data, config, log, homebridge, vivintApi) {
        super(accessory, data, config, log, homebridge, vivintApi)
      
      this.log = log
      this.service = accessory.getService(this.Service.LockMechanism)

      this.batteryService.updateCharacteristic(this.Characteristic.ChargingState, this.Characteristic.ChargingState.NOT_CHARGEABLE)

      this.service
        .getCharacteristic(this.Characteristic.LockCurrentState)
        .on('get', async callback => this.getCurrentState(callback))

      this.service
        .getCharacteristic(this.Characteristic.LockTargetState)
        //.on('get', async callback => this.getTargetState(callback))
        .on('set', async (state, callback) => this.setTargetState(state, callback))

      this.notify()
    }

    async setTargetState(targetState, callback) {
      let locked = (targetState == this.Characteristic.LockCurrentState.SECURED)     
      try {
        callback()
        await this.vivintApi.setLockState(this.id, locked)
      }
      catch (err) {
        this.log.error("Failure setting lock state:", err)
        callback(new Error(`An error occurred while setting the door lock state: ${err}`))
      }
    }

    // async getTargetState(callback) {
    //   let state = this.service.getCharacteristic(this.Characteristic.LockTargetState).value
    //   return callback(null, state)
    // }

    async getCurrentState(callback) {
      return callback(null, this.getLockState())
    }

    getLockState() {
      switch (this.data.Status){
        case false:
          return this.Characteristic.LockCurrentState.UNSECURED
        case true:
          return this.Characteristic.LockCurrentState.SECURED
        case this.Characteristic.LockCurrentState.JAMMED:
          return this.Characteristic.LockCurrentState.JAMMED
      }
    }

    notify() {
      super.notify()
      if (this.service) {
        let state = this.getLockState()
        this.service.updateCharacteristic(this.Characteristic.LockCurrentState, state)
        this.service.updateCharacteristic(this.Characteristic.LockTargetState, state == this.Characteristic.LockTargetState.SECURED);
      }
    }

    static appliesTo(data) {
      return data.Type == VivintDict.PanelDeviceType.DoorLock
    }

    static inferCategory(data, Accessory) {
        return Accessory.Categories.DOOR_LOCK
    }

    static addServices(accessory, Service) {
      super.addServices(accessory, Service)
      accessory.addService(new Service.LockMechanism(accessory.context.name))
    }
  }

  module.exports = Lock