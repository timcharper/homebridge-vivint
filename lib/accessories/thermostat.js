const Device = require('../device.js')
const VivintDict = require("../vivint_dictionary.json")
const debounce = require("debounce-promise")

const DEBOUNCE_SECONDS = 2

class Thermostat extends Device {
    constructor(accessory, data, config, log, homebridge, vivintApi) {
        super(accessory, data, config, log, homebridge, vivintApi)
      
      this.log = log
      
      this.service = accessory.getService(this.Service.Thermostat)
      this.fanService = accessory.getService(this.Service.Fan)

      /*
       * Only allow 0.5 increments for Celsius temperatures. HomeKit is already limited to 1-degree increments in Fahrenheit,
       * and setting this value for Fahrenheit will cause HomeKit to incorrectly round values when converting from °F to °C and back.
       */
      let minSetTemp, maxSetTemp, minGetTemp, maxGetTemp;
      this.tempStep = 0.1;
      if (this.isCelsius()) {
        minSetTemp = 10;
        maxSetTemp = 32;
        minGetTemp = -20;
        maxGetTemp = 60;
      } else {
        minSetTemp = this.fahrenheitToCelsius(50);
        maxSetTemp = this.fahrenheitToCelsius(90);
        minGetTemp = this.fahrenheitToCelsius(0);
        maxGetTemp = this.fahrenheitToCelsius(160);
      }

      this.service
        .getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
        .on('get', async callback => this.getCurrentHeatingCoolingState(callback))

      this.service
        .getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
        .on('get', async callback => this.getTargetHeatingCoolingState(callback))
        .on('set', async (state, callback) => this.setTargetHeatingCoolingState(state, callback))

      this.service
        .getCharacteristic(this.Characteristic.CurrentTemperature)
        .setProps({ minStep: this.tempStep, minValue: minGetTemp, maxValue: maxGetTemp })
        .on('get', async callback => this.getCurrentTemperature(callback))

      this.service
        .getCharacteristic(this.Characteristic.TargetTemperature)
        .setProps({ minStep: this.tempStep, minValue: minSetTemp, maxValue: maxSetTemp })
        .on('get', async callback => this.getTargetTemperature(callback))
        .on('set', async (target, callback) => this.setTargetTemperature(target, callback))

      this.service
        .getCharacteristic(this.Characteristic.CurrentRelativeHumidity)
        .on('get', async callback => this.getCurrentRelativeHumidity(callback))

      this.service
        .getCharacteristic(this.Characteristic.CoolingThresholdTemperature)
        .setProps({ minStep: this.tempStep, minValue: minSetTemp, maxValue: maxSetTemp })
        .on('get', async callback => this.getCoolingThresholdTemperature(callback))
        .on('set', async (target, callback) => this.setCoolingThresholdTemperature(target, callback))

      this.service
        .getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
        .setProps({ minStep: this.tempStep, minValue: minSetTemp, maxValue: maxSetTemp })
        .on('get', async callback => this.getHeatingThresholdTemperature(callback))
        .on('set', async (target, callback) => this.setHeatingThresholdTemperature(target, callback))

      this.service
        .getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
        .on('get', async callback => this.getTemperatureDisplayUnits(callback))


      this.fanService
        .getCharacteristic(this.Characteristic.On)
        .on('get', async callback => this.getFanOn(callback))
        .on('set', async (target, callback) => this.setFanOn(target, callback))
    }

    async getCurrentHeatingCoolingState(callback) {
      return callback(null, this.getOperatingState())
    }

    getOperatingState() {
      switch (this.data.OperatingState) {
        case VivintDict.OperatingStates.IDLE:
          return this.Characteristic.CurrentHeatingCoolingState.OFF
        case VivintDict.OperatingStates.HEATING:
          return this.Characteristic.CurrentHeatingCoolingState.HEAT
        case VivintDict.OperatingStates.COOLING:
          return this.Characteristic.CurrentHeatingCoolingState.COOL
      }
    }

    async getTargetHeatingCoolingState(callback) {
      return callback(null, this.getOperatingMode())
    }

    getOperatingMode() {
      switch (this.data.OperatingMode) {
        case VivintDict.OperatingModes.OFF:
          return this.Characteristic.TargetHeatingCoolingState.OFF
        case VivintDict.OperatingModes.HEAT:
          return this.Characteristic.TargetHeatingCoolingState.HEAT
        case VivintDict.OperatingModes.COOL:
          return this.Characteristic.TargetHeatingCoolingState.COOL
        case VivintDict.OperatingModes.AUTO:
          return this.Characteristic.TargetHeatingCoolingState.AUTO
        case VivintDict.OperatingModes.ECO:
          return this.Characteristic.TargetHeatingCoolingState.AUTO // eco mode
      }
    }

    async setTargetHeatingCoolingState(state, callback) {
      var setValue = 0

      switch (state) {
        case this.Characteristic.TargetHeatingCoolingState.OFF:
          setValue = VivintDict.OperatingModes.OFF;
          break
        case this.Characteristic.TargetHeatingCoolingState.HEAT:
          setValue = VivintDict.OperatingModes.HEAT;
          break
        case this.Characteristic.TargetHeatingCoolingState.COOL:
          setValue = VivintDict.OperatingModes.COOL;
          break
        case this.Characteristic.TargetHeatingCoolingState.AUTO:
          setValue = VivintDict.OperatingModes.AUTO;
          break
      }

      try {
        await this.vivintApi.setThermostatState(this.id, setValue)
        callback(null)
      }
      catch (err) {
        this.log.error("Failure setting thermostat Target Heating/Cooling state:", setValue, err)
        callback(new Error(`Failure setting thermostat Target Heating/Cooling state: ${setValue} ${err}`))
      }
    }

    async getCurrentTemperature(callback) {
      return callback(null, this.getTemperatureValue())
    }

    getTemperatureValue() {
      return this.unroundTemperature(this.data.Value)
    }

    async getTargetTemperature(callback) {
      return callback(null, this.getTargetTemperatureValue())
    }

    getTargetTemperatureValue() {
      switch (this.getOperatingMode()) {
        case this.Characteristic.TargetHeatingCoolingState.OFF:
          return this.getTemperatureValue()
        case this.Characteristic.TargetHeatingCoolingState.HEAT:
          return this.getHeatSetPoint()
        case this.Characteristic.TargetHeatingCoolingState.COOL:
          return this.getCoolSetPoint()
        case this.Characteristic.TargetHeatingCoolingState.AUTO:
          return this.getTemperatureValue()
      }
    }
    
    async setTargetTemperature(temperature, callback) {
      switch (this.getOperatingMode()) {
        case this.Characteristic.TargetHeatingCoolingState.OFF:
          callback() //Can't set target temperature when thermostat is off
          break
        case this.Characteristic.TargetHeatingCoolingState.HEAT:
          try {
            callback()
            await debounce(this.vivintApi.setThermostatHeatSetPoint(this.id, temperature), DEBOUNCE_SECONDS * 1000, { leading: true })
          }
          catch (err) {
            this.log.error("Failure setting target temperature:", temperature, err)
            callback(new Error(`An error occurred while setting target temperature: ${temperature} ${err}`))
          }
          break
        case this.Characteristic.CurrentHeatingCoolingState.COOL:
          try {
            callback()
            await debounce(this.vivintApi.setThermostatCoolSetPoint(this.id, temperature), DEBOUNCE_SECONDS * 1000, { leading: true })
          }
          catch (err) {
            this.log.error("Failure setting target temperature:", temperature, err)
            callback(new Error(`An error occurred while setting target temperature: ${temperature} ${err}`))
          }
          break
        case this.Characteristic.TargetHeatingCoolingState.AUTO:
          callback() //Can't set target temperature in auto mode
          break
      }
    }

    async getCoolingThresholdTemperature(callback) {
      return callback(null, this.getCoolingThresholdTemperatureValue())
    }

    getCoolingThresholdTemperatureValue() {
      switch (this.getOperatingMode()) {
        case this.Characteristic.TargetHeatingCoolingState.OFF:
          return this.getTemperatureValue()
        case this.Characteristic.TargetHeatingCoolingState.HEAT:
          return this.getHeatSetPoint()
        case this.Characteristic.TargetHeatingCoolingState.COOL:
        case this.Characteristic.TargetHeatingCoolingState.AUTO:
          return this.getCoolSetPoint()
      }
    }

    getCoolSetPoint() {
      return this.unroundTemperature(this.data.CoolSetPoint);
    }

    async setCoolingThresholdTemperature(value, callback) {
      try {
        callback()
        await debounce(this.vivintApi.setThermostatCoolSetPoint(this.id, value), DEBOUNCE_SECONDS * 1000, { leading: true })
      }
      catch (err) {
        this.log.error("Failure setting Cooling Threshold temperature:", value, err)
        callback(new Error(`An error occurred while setting Cooling Threshold temperature: ${value} ${err}`))
      }
    }

    async getHeatingThresholdTemperature(callback) {
      return callback(null, this.getHeatingThresholdTemperatureValue())
    }

    getHeatingThresholdTemperatureValue() {
      switch (this.getOperatingMode()) {
        case this.Characteristic.TargetHeatingCoolingState.OFF:
          return this.getTemperatureValue()
        case this.Characteristic.TargetHeatingCoolingState.COOL:
          return this.getCoolSetPoint()
        case this.Characteristic.TargetHeatingCoolingState.HEAT:
        case this.Characteristic.TargetHeatingCoolingState.AUTO:
          return this.getHeatSetPoint()
      }
    }

    getHeatSetPoint() {
      return this.unroundTemperature(this.data.HeatSetPoint);
    }

    async setHeatingThresholdTemperature(value, callback) {
      try {
        callback()
        await debounce(this.vivintApi.setThermostatHeatSetPoint(this.id, value), DEBOUNCE_SECONDS * 1000, { leading: true })
      }
      catch (err) {
        this.log.error("Failure setting Heating Threshold temperature:", value, err)
        callback(new Error(`An error occurred while setting Heating Threshold temperature: ${value} ${err}`))
      }
    }

    getCurrentRelativeHumidity(callback) {
      return callback(null, this.getHumidityValue())
    }

    getHumidityValue() {
      return this.data.Humidity
    }

    async getFanOn(callback) {
      return callback(null, this.getFanState())
    }

    getFanState() {
      return this.data.FanState == 1
    }

    async setFanOn(fanOn, callback) {

      let fanState = fanOn ? 100 : 0

      try {
        callback()
        await debounce(this.vivintApi.setThermostatFanState(this.id, fanState), DEBOUNCE_SECONDS * 1000, { leading: true })
      }
      catch (err) {
        this.log.error("Failure setting Fan state:", fanState, err)
        callback(new Error(`An error occurred while setting Fan state: ${fanState} ${err}`))
      }
    }

    async getTemperatureDisplayUnits(callback) {
      return callback(null, this.isCelsius() ? this.Characteristic.TemperatureDisplayUnits.CELCIUS : this.Characteristic.TemperatureDisplayUnits.FAHRENHEIT)
    }

    isCelsius() {
      return Boolean(this.data.TemperatureCelsius)
    }

    unroundTemperature(temperature){
      if (this.isCelsius()) {
        let tempC = 0.5 * Math.round(2 * temperature)
        return tempC
      }
      else {
        let tempF = Math.round(this.celsiusToFahrenheit(temperature));
        return this.fahrenheitToCelsius(tempF)
      }         
    }

    fahrenheitToCelsius(temperature) {
      return (temperature - 32) / 1.8
    }
    
    celsiusToFahrenheit(temperature) {
      return (temperature * 1.8) + 32
    }

    notify() {
      if (this.service) {

        this.service.updateCharacteristic(this.Characteristic.CurrentHeatingCoolingState, this.getOperatingState())
        this.service.updateCharacteristic(this.Characteristic.TargetHeatingCoolingState, this.getOperatingMode())
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, this.getTemperatureValue())
        this.service.updateCharacteristic(this.Characteristic.TargetTemperature, this.getTargetTemperatureValue())
        this.service.updateCharacteristic(this.Characteristic.CurrentRelativeHumidity, this.getHumidityValue())
        this.service.updateCharacteristic(this.Characteristic.CoolingThresholdTemperature, this.getCoolingThresholdTemperatureValue())
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, this.getHeatingThresholdTemperatureValue())
        this.service.updateCharacteristic(this.Characteristic.TemperatureDisplayUnits, this.isCelsius() ? this.Characteristic.TemperatureDisplayUnits.CELCIUS : this.Characteristic.TemperatureDisplayUnits.FAHRENHEIT)

        this.fanService.updateCharacteristic(this.Characteristic.On, this.getFanState())
      }
    }

    static appliesTo(data) {
      return data.Type == VivintDict.PanelDeviceType.Thermostat
    }
    static inferCategory(data, Accessory) {
      return Accessory.Categories.THERMOSTAT
    }

    static addServices(accessory, Service) {
      accessory.addService(new Service.Thermostat(accessory.context.name))
      accessory.addService(new Service.Fan(accessory.context.name + " fan"))
    }
  }

  module.exports = Thermostat