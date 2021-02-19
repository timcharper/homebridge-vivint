const Device = require('../device.js')
const VivintDict = require("../vivint_dictionary.json")

class SmokeSensor extends Device {
    constructor(accessory, data, config, log, homebridge, vivintApi) {
        super(accessory, data, config, log, homebridge, vivintApi)
      
      this.service = accessory.getService(this.Service.SmokeSensor)

      this.batteryService.updateCharacteristic(this.Characteristic.ChargingState, this.Characteristic.ChargingState.NOT_CHARGEABLE)
      
      this.service
        .getCharacteristic(this.Characteristic.SmokeDetected)
        .on('get', callback => callback(null, this.getSensorState()))
      
      this.service
        .getCharacteristic(this.Characteristic.StatusTampered)
        .on('get', callback => callback(null, this.getTamperedState()))

      this.notify()
    }

    getSensorState() {
      if (Boolean(this.data.Status))
        return this.Characteristic.SmokeDetected.SMOKE_DETECTED
      else
        return this.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED
    }

    notify() {
      super.notify()
      if (this.service) {
        this.service.updateCharacteristic(this.Characteristic.SmokeDetected, this.getSensorState())
        this.service.updateCharacteristic(this.Characteristic.StatusTampered, this.getTamperedState())
      }
    }

    static appliesTo (data) {
      return (
        (data.Type == VivintDict.PanelDeviceType.WirelessSensor) && 
        (
          (data.EquipmentCode == VivintDict.EquipmentCode.FIREFIGHTER_AUDIO_DETECTOR) ||
          (data.EquipmentCode == VivintDict.EquipmentCode.HW_SMOKE_5808W3) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.EXISTING_SMOKE) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.SMKE1_SMOKE_CANADA) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.SMKE1_SMOKE) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.VS_SMKT_SMOKE_DETECTOR) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.SMKT2_GE_SMOKE_HEAT) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.SMKT3_2GIG) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.SMKT6_2GIG)
        ) 
      )
    }

    static inferCategory(data, Accessory) {
        return Accessory.Categories.SENSOR
    }

    static addServices(accessory, Service) {
      super.addServices(accessory, Service)
      accessory.addService(new Service.SmokeSensor(accessory.context.name))
    }
  }

  module.exports = SmokeSensor