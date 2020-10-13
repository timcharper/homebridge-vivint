const dataPatch = require("../lib/datapatch.js")

class Device {
    constructor(accessory, data, config, log, homebridge, vivintApi) {
        this.Service = homebridge.hap.Service
        this.Accessory = homebridge.hap.Accessory
        this.Characteristic = homebridge.hap.Characteristic

        this.config = config
        this.log = log
        this.vivintApi = vivintApi

        this.id = accessory.context.id
        this.name = accessory.context.name
        this.data = data || {}

        this.batteryService = accessory.getService(this.Service.BatteryService)
    }

    getBatteryLevelValue() {
      return Object.is(this.data.BatteryLevel, undefined) ? 100 : this.data.BatteryLevel
    }

    getLowBatteryState() {
      if (Boolean(this.data.LowBattery)) {
        return this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      }
      else {
        return this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
      }
    }

    getTamperedState() {
      if (Boolean(this.data.Tamper)) {
        return this.Characteristic.StatusTampered.TAMPERED
      }
      else {
        return this.Characteristic.StatusTampered.NOT_TAMPERED
      }
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
      if (this.batteryService) {
        this.batteryService.updateCharacteristic(this.Characteristic.StatusLowBattery, this.getLowBatteryState())
        this.batteryService.updateCharacteristic(this.Characteristic.BatteryLevel, this.getBatteryLevelValue())
      }
    }

    static appliesTo(data) {
      throw "appliesTo is not implemented"
    }

    static inferCategory(data) {
      throw "inferCategory is not implemented"
    }

    static addServices(accessory) {
      throw "addServices is not implemented"
    }
}

module.exports = Device