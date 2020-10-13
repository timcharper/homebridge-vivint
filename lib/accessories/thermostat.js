const Device = require('../device.js')
const VivintDict = require("../vivint_dictionary.json")
const ThermostatCharacteristicsModule = require("../thermostat_characteristics.js")
const debounce = require("debounce-promise")

class Thermostat extends Device {
    constructor(accessory, data, config, log, homebridge, vivintApi) {
        super(accessory, data, config, log, homebridge, vivintApi)

      this.config_temperatureUnits = (config.temperatureUnits || "f").toLowerCase()

      if (this.config_temperatureUnits != "c" && this.config_temperatureUnits != "f") {
        throw "config.temperatureUnits must be 'c' or 'f'; got this instead: " + config_temperatureUnits
      }

      this.ThermostatCharacteristics = ThermostatCharacteristicsModule(homebridge)
      
      this.service = accessory.getService(this.Service.Thermostat)
      this.fanService = accessory.getService(this.Service.Fan)

      let self = this
      let getter = function(fn) {
        let bound = fn.bind(self)
        return (next) => {
          let result = bound()
          next(null, result)
        }
      }

      let promiseSetter = function(fn) {
        let boundDebounced = debounce(fn.bind(self), 5000, {
          leading: true
        })
        return (value, next) => {
          boundDebounced(value).then(
            (result) => {
              next()
            },
            (failure) => {
              log.error("Failure setting thermostat state:", failure)
              next(failure)
            }
          )
        }
      }

      this.service
        .getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
        .on('get', getter(this.getCurrentHeatingCoolingState))

      this.service
        .getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
        .on('get', getter(this.getTargetHeatingCoolingState))
        .on('set', promiseSetter(this.setTargetHeatingCoolingState))

      this.service
        .getCharacteristic(this.Characteristic.CurrentTemperature)
        .on('get', getter(this.getCurrentTemperature))

      this.service
        .getCharacteristic(this.Characteristic.TargetTemperature)
        .on('get', getter(this.getTargetTemperature))
        .on('set', promiseSetter(this.setTargetTemperature))

      this.service
        .getCharacteristic(this.Characteristic.CurrentRelativeHumidity)
        .on('get', getter(this.getCurrentRelativeHumidity))

      this.service
        .getCharacteristic(this.Characteristic.CoolingThresholdTemperature)
        .on('get', getter(this.getCoolingThresholdTemperature))
        .on('set', promiseSetter(this.setCoolingThresholdTemperature))

      this.service
        .getCharacteristic(this.this.Characteristic.HeatingThresholdTemperature)
        .on('get', getter(this.getHeatingThresholdTemperature))
        .on('set', promiseSetter(this.setHeatingThresholdTemperature))

      this.service
        .getCharacteristic(this.ThermostatCharacteristics.HasLeaf)
        .on('get', getter(this.getHasLeaf))

      this.service
        .getCharacteristic(this.this.Characteristic.TemperatureDisplayUnits)
        .on('get', getter(this.getTemperatureDisplayUnits))


      this.fanService
        .getCharacteristic(this.this.Characteristic.On)
        .on('get', getter(this.getFanOn))
        .on('set', promiseSetter(this.setFanOn))
    }

    getCurrentHeatingCoolingState() {
      switch (this.data.OperatingState) {
        case VivintDict.OperatingStates.IDLE:
          return this.Characteristic.CurrentHeatingCoolingState.OFF
        case VivintDict.OperatingStates.HEATING:
          return this.Characteristic.CurrentHeatingCoolingState.HEAT
        case VivintDict.OperatingStates.COOLING:
          return this.Characteristic.CurrentHeatingCoolingState.COOL
      }
    }

    getTargetHeatingCoolingState() {
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

    setTargetHeatingCoolingState(state) {
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

      return this.vivintApi.putDevice('thermostats', this.id, {
        _id: this.id,
        om: setValue
      })
    }

    getCurrentTemperature() {
      return this.data.Value
    }

    getTargetTemperature() {
      switch (this.getTargetHeatingCoolingState()) {
        case this.Characteristic.TargetHeatingCoolingState.OFF:
          return this.getCurrentTemperature()
        case this.Characteristic.TargetHeatingCoolingState.HEAT:
          return this.getHeatingThresholdTemperature()
        case this.Characteristic.TargetHeatingCoolingState.COOL:
          return this.getCoolingThresholdTemperature()
        case this.Characteristic.TargetHeatingCoolingState.AUTO:
          return this.getCurrentTemperature()
      }
    }
    setTargetTemperature(temperature) {
      switch (this.getTargetHeatingCoolingState()) {
        case this.Characteristic.TargetHeatingCoolingState.OFF:
          return Promise.reject("Can't set target temperature when thermostat is off")
        case this.Characteristic.TargetHeatingCoolingState.HEAT:
          return this.vivintApi.putDevice('thermostats', this.id, {
            _id: this.id,
            hsp: temperature,
            currentAutoMode: 1
          })
        case this.Characteristic.TargetHeatingCoolingState.COOL:
          return this.vivintApi.putDevice('thermostats', this.id, {
            _id: this.id,
            csp: temperature,
            currentAutoMode: 2
          })
        case this.Characteristic.TargetHeatingCoolingState.AUTO:
          return Promise.reject("Can't set target temperature in auto mode")
      }
    }

    getCoolingThresholdTemperature() {
      return this.data.CoolSetPoint;
    }

    setCoolingThresholdTemperature(value) {
      return this.vivintApi.putDevice('thermostats', this.id, {
        _id: this.id,
        csp: value
      })
    }

    getHeatingThresholdTemperature() {
      return this.data.HeatSetPoint;
    }

    setHeatingThresholdTemperature(value) {
      return this.vivintApi.putDevice('thermostats', this.id, {
        _id: this.id,
        hsp: value
      })
    }

    getCurrentRelativeHumidity() {
      return this.data.Humidity
    }

    getHasLeaf() {
      return this.data.OperatingMode == 100
    }

    getFanOn() {
      return this.data.FanState == 1
    }

    setFanOn(fanOn) {
      let setValue = fanOn ? 100 : 0
      return this.vivintApi.putDevice('thermostats', this.id, {
        _id: this.id,
        fm: setValue
      })
    }

    getTemperatureDisplayUnits() {
      if (config_temperatureUnits == "f")
        return this.Characteristic.TemperatureDisplayUnits.FAHRENHEIT
      else
        return this.Characteristic.TemperatureDisplayUnits.CELSIUS
    }

    notify() {
      if (this.service) {
        this.service
          .getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
          .updateValue(this.getCurrentHeatingCoolingState())

        this.service
          .getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
          .updateValue(this.getTargetHeatingCoolingState())

        this.service
          .getCharacteristic(this.Characteristic.CurrentTemperature)
          .updateValue(this.getCurrentTemperature())

        this.service
          .getCharacteristic(this.Characteristic.TargetTemperature)
          .updateValue(this.getTargetTemperature())

        this.service
          .getCharacteristic(this.Characteristic.CurrentRelativeHumidity)
          .updateValue(this.getCurrentRelativeHumidity())

        this.service
          .getCharacteristic(this.Characteristic.CoolingThresholdTemperature)
          .updateValue(this.getCoolingThresholdTemperature())

        this.service
          .getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
          .updateValue(this.getHeatingThresholdTemperature())

        this.service
          .getCharacteristic(this.ThermostatCharacteristics.HasLeaf)
          .updateValue(this.getHasLeaf())

        this.service
          .getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
          .updateValue(this.getTemperatureDisplayUnits())

        this.fanService
          .getCharacteristic(this.Characteristic.On)
          .updateValue(this.getFanOn())
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