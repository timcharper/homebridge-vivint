var Accessory, Service, Characteristic, UUIDGen;

const VivintApiModule = require("./lib/vivint_api.js")
const DeviceSetModule = require("./lib/device_set.js")

module.exports = function (homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  class VivintPlatform {
    constructor(log, config, api) {
      this.log = log
      this.config = config
      this.api = api

      let VivintApi = VivintApiModule(config, log)
      let vivintApiPromise = VivintApi.login({username: config.username, password: config.password})
      let deviceSetPromise = vivintApiPromise.then((vivintApi) => {
        let DeviceSet = DeviceSetModule(config, log, homebridge, vivintApi)
        return new DeviceSet(vivintApi.systemInfo.system.par[0].d);
      })

      let pubNubPromise = vivintApiPromise.then((vivintApi) => vivintApi.connectPubNub())

      Promise.all([pubNubPromise, deviceSetPromise]).then((resolved) => {
        let pubNub = resolved[0]
        let deviceSet = resolved[1]
        console.log(pubNub)
        console.log("===============")
        pubNub.addListener({
          status: function(statusEvent) {
            console.log("status", statusEvent)
          },
          message: function(msg) {
            log("received pubNub msg")
            log(msg)
            deviceSet.handleMessage(msg)
          },
          presence: function(presenceEvent) {
            console.log("presence", presenceEvent)
          }
        })
        console.log("!===============")
      })

      this.accessories = (next) => {
        deviceSetPromise.then(
          (deviceSet) => {
            console.log("deviceSet", deviceSet)
            next(deviceSet.devices)
          },
          (error) => {
            log("error initializing vivint api: " + error)
            next([])
          }
        )
      }
    }
  }

  homebridge.registerPlatform("homebridge-vivint", "Vivint", VivintPlatform);
};
