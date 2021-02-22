const Device = require('../device.js')
const VivintDict = require("../vivint_dictionary.json")

class Panel extends Device {
    constructor(accessory, data, config, log, homebridge, vivintApi) {
        super(accessory, data, config, log, homebridge, vivintApi)

      this.log = log
      this.service = accessory.getService(this.Service.SecuritySystem)

      this.VIVINT_TO_HOMEKIT = {
        [VivintDict.SecurityState.DISARMED]:                  this.Characteristic.SecuritySystemCurrentState.DISARMED,
        [VivintDict.SecurityState.ARMING_AWAY_IN_EXIT_DELAY]: this.Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        [VivintDict.SecurityState.ARMING_STAY_IN_EXIT_DELAY]: this.Characteristic.SecuritySystemCurrentState.STAY_ARM,
        [VivintDict.SecurityState.ARMED_STAY]:                this.Characteristic.SecuritySystemCurrentState.STAY_ARM,
        [VivintDict.SecurityState.ARMED_AWAY]:                this.Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        [VivintDict.SecurityState.ARMED_STAY_IN_ENTRY_DELAY]: this.Characteristic.SecuritySystemCurrentState.STAY_ARM,
        [VivintDict.SecurityState.ARMED_AWAY_IN_ENTRY_DELAY]: this.Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        [VivintDict.SecurityState.ALARM]:                     this.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED,
        [VivintDict.SecurityState.ALARM_FIRE]:                this.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED,
        [VivintDict.SecurityState.DISABLED]:                  this.Characteristic.SecuritySystemCurrentState.DISARMED,
        [VivintDict.SecurityState.WALK_TEST]:                 this.Characteristic.SecuritySystemCurrentState.DISARMED
      };

      this.HOMEKIT_TO_VIVINT = {
        [this.Characteristic.SecuritySystemTargetState.DISARM]: VivintDict.SecurityState.DISARMED,
        [this.Characteristic.SecuritySystemTargetState.STAY_ARM]: VivintDict.SecurityState.ARMED_STAY,
        [this.Characteristic.SecuritySystemTargetState.AWAY_ARM]: VivintDict.SecurityState.ARMED_AWAY
      };

      this.VALID_CURRENT_STATE_VALUES = [
        this.Characteristic.SecuritySystemCurrentState.STAY_ARM,
        this.Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        this.Characteristic.SecuritySystemCurrentState.DISARMED,
        this.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
      ];

      this.VALID_TARGET_STATE_VALUES = [
          this.Characteristic.SecuritySystemTargetState.STAY_ARM,
          this.Characteristic.SecuritySystemTargetState.AWAY_ARM,
          this.Characteristic.SecuritySystemTargetState.DISARM
      ];

      this.service
        .getCharacteristic(this.Characteristic.SecuritySystemCurrentState)
        .setProps({ validValues: this.VALID_CURRENT_STATE_VALUES })
        .on('get', async callback => this.getCurrentState(callback))

      this.service
        .getCharacteristic(this.Characteristic.SecuritySystemTargetState)
        .setProps({ validValues: this.VALID_TARGET_STATE_VALUES })
        //.on('get', async callback => this.getTargetState(callback))
        .on('set', async (state, callback) => this.setTargetState(state, callback))

      //this.notify()
    }

    getPanelState() {
      return this.VIVINT_TO_HOMEKIT[this.data.Status];
    }

    async getCurrentState(callback) {
      return callback(null, this.getPanelState())
    }

    // async getTargetState(callback) {
    //   return callback(null, this.service.getCharacteristic(this.Characteristic.SecuritySystemTargetState).value);
    // }

    async setTargetState(targetState, callback) {
      let vivintState = this.HOMEKIT_TO_VIVINT[targetState]   
      
      try {
        callback() 

        //Vivint does not support changing from Stay to Away and vice versa when armed so we need to disarm first
        if (targetState !== this.Characteristic.SecuritySystemTargetState.DISARM &&
          this.getPanelState() !== this.Characteristic.SecuritySystemCurrentState.DISARMED) {
            await this.vivintApi.setPanelState(this.HOMEKIT_TO_VIVINT[this.Characteristic.SecuritySystemTargetState.DISARM])
        }

        await this.vivintApi.setPanelState(vivintState)
      }
      catch (err) {
        this.log.error("Failure setting panel state:", err)
        callback(new Error(`An error occurred while setting the panel state: ${err}`))
      }
    }

    notify(){
      super.notify()
      if (this.service) {
        let state = this.getPanelState()
        if (state !== undefined) {
          this.service
            .updateCharacteristic(this.Characteristic.SecuritySystemCurrentState, state)
            .updateCharacteristic(this.Characteristic.SecuritySystemTargetState, state)
        }
      }
    }

    static appliesTo(data) {
      return data.Type == VivintDict.PanelDeviceType.Panel
    }

    static inferCategory(data, Accessory) {
      return Accessory.Categories.SECURITY_SYSTEM
    }

    static addServices(accessory, Service) {
      super.addServices(accessory, Service)
      accessory.addService(new Service.SecuritySystem(accessory.context.name))
    }
  }

  module.exports = Panel