var Accessory, Service, Characteristic, UUIDGen;

const VivintApiModule = require("./lib/vivint_api.js")
const DeviceSetModule = require("./lib/device_set.js")
const ThermostatCharacteristicsModule = require("./lib/thermostat_characteristics.js")

module.exports = function (homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  let ThermostatCharacteristics = ThermostatCharacteristicsModule(homebridge)

  class VivintPlatform {
    constructor(log, config, api) {
      this.log = log
      this.config = config
      this.api = api

      let VivintApi = VivintApiModule(config, log)
      let vivintApiPromise = VivintApi.login({username: config.username, password: config.password})
      let apiLoginRefreshSecs = config.apiLoginRefreshSecs || 1200 // once per 20 minutes default


      let deviceSetPromise = vivintApiPromise.then((vivintApi) => {
        let DeviceSet = DeviceSetModule(config, log, homebridge, vivintApi, ThermostatCharacteristics, setInterval, Date)
        let deviceData = vivintApi.deviceSnapshot()
        let deviceSet = new DeviceSet(deviceData, vivintApi.deviceSnapshotTs())
        setInterval(() => {

          vivintApi.renew()
            .then((_) => vivintApi.renewSystemInfo())
            .then((systemInfo) => {
              deviceSet.handleSnapshot(vivintApi.deviceSnapshot(), vivintApi.deviceSnapshotTs())})
            .catch((err) => log("error refreshing", err))
        }, apiLoginRefreshSecs * 1000)

        return deviceSet;
      })

      let pubNubPromise = vivintApiPromise.then((vivintApi) => vivintApi.connectPubNub())

      Promise.all([pubNubPromise, deviceSetPromise]).then((resolved) => {
        let pubNub = resolved[0]
        let deviceSet = resolved[1]
        pubNub.addListener({
          status: function(statusEvent) {
            console.log("status", statusEvent)
          },
          message: function(msg) {
            log("received pubNub msg")
            log(JSON.stringify(msg.message))
            deviceSet.handleMessage(msg)
          },
          presence: function(presenceEvent) {
            console.log("presence", presenceEvent)
          }
        })
      })

      this.accessories = (next) => {
        deviceSetPromise.then(
          (deviceSet) => next(deviceSet.devices),
          (error) => {
            log("error initializing vivint api: " + error)
            next(null)
          }
        )
      }
    }
  }

  homebridge.registerPlatform("homebridge-vivint", "Vivint", VivintPlatform);
};
