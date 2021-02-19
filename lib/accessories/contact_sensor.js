const Device = require('../device.js')
const VivintDict = require("../vivint_dictionary.json")

class ContactSensor extends Device {
    constructor(accessory, data, config, log, homebridge, vivintApi) {
        super(accessory, data, config, log, homebridge, vivintApi)
      this.service = accessory.getService(this.Service.ContactSensor)
      
      this.batteryService.updateCharacteristic(this.Characteristic.ChargingState, this.Characteristic.ChargingState.NOT_CHARGEABLE)
      
      this.service
        .getCharacteristic(this.Characteristic.ContactSensorState)
        .on('get', callback => callback(null, this.getSensorState()))
      
      this.service
        .getCharacteristic(this.Characteristic.StatusTampered)
        .on('get', callback => callback(null, this.getTamperedState()))

      this.notify()
    }

    getSensorState() {
      if (Boolean(this.data.Status))
        return this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      else
        return this.Characteristic.ContactSensorState.CONTACT_DETECTED
    }

    notify() {
      super.notify()
      if (this.service) {
        this.service.updateCharacteristic(this.Characteristic.ContactSensorState, this.getSensorState())
        this.service.updateCharacteristic(this.Characteristic.StatusTampered, this.getTamperedState())
      }
    }

    static appliesTo(data) {
      return (
        (data.Type == VivintDict.PanelDeviceType.WirelessSensor) && 
        (
          (data.EquipmentCode == VivintDict.EquipmentCode.DW21R_RECESSED_DOOR) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.DW10_THIN_DOOR_WINDOW) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.DW11_THIN_DOOR_WINDOW) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.DW20_RECESSED_DOOR) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.EXISTING_DOOR_WINDOW_CONTACT) ||
          (data.EquipmentCode == VivintDict.EquipmentCode.TAKE_TAKEOVER) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.GB1_GLASS_BREAK) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.GB2_GLASS_BREAK) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.EXISTING_GLASS_BREAK) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.HW_GLASS_BREAK_5853) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.TILT_SENSOR_2GIG_345) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.EXISTING_HEAT) || 
          (data.EquipmentCode == VivintDict.EquipmentCode.EXISTING_FLOOD_TEMP)
        ) 
      )
    }

    static inferCategory(data, Accessory) {
      let name = data.Name

      if (name.match(/\bwindow\b/i))
        return Accessory.Categories.WINDOW
      else if (name.match(/\bdoor(way)?\b/i))
        return Accessory.Categories.DOOR
      else
        return Accessory.Categories.SENSOR
    }

    static addServices(accessory, Service) {
      super.addServices(accessory, Service)
      accessory.addService(new Service.ContactSensor(accessory.context.name))
    }
}

module.exports = ContactSensor