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

      this.accessories = (next) => {
        deviceSetPromise.then(
          (deviceSet) => next(undefined, deviceSet.devices),
          (error) => next(error)
        )
      }
    }
  }

  homebridge.registerPlatform("homebridge-vivint", "Vivint", VivintPlatform);
};
