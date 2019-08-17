const request = require("request-promise-native")
const PubNub = require('pubnub')
const extend = require('util')._extend

function VivintApiModule(config, log) {
  class VivintApi {
    constructor(creds, panelId, cookie, sessionInfo, systemInfo) {
      this.creds = creds
      this.panelId = panelId
      this.parId = systemInfo.system.par[0].parid
      this.cookie = cookie
      this.sessionInfo = sessionInfo
      this.systemInfo = systemInfo
    }

    deviceSnapshot() {
      return this.systemInfo.system.par[0]
    }

    deviceSnapshotTs() {
      return this.systemInfo.system.pnlctx.ts
    }

    renew() {
      let self = this
      return VivintApi.doAuth(this.creds).then(
        (result) => {
          log("Renewed Vivint API session. ", self.cookie, result.cookie)
          self.cookie = result.cookie
          self.sessionInfo = result.sessionInfo
          return this
        },
        (error) => {
          console.log("error renewing login", error)
          setTimeout(() => { this.renew() }, 5000)
        }
      )
    }

    renewSystemInfo() {
      return VivintApi.getSystemInfo(this.cookie, this.panelId).then((sysInfo) => {
        this.systemInfo = sysInfo
        return true
      })
    }

    connectPubNub() {
      let channel = "PlatformChannel#" + this.sessionInfo.u.mbc
      let pubnub = new PubNub({
        subscribeKey : "sub-c-6fb03d68-6a78-11e2-ae8f-12313f022c90"
      })
      pubnub.subscribe({
        channels: [channel]
      })
      return pubnub;
    }

    /**
     * Resource URL to some thing. uri should start with '/'
     */
    getPanelUrl(uri) {
      return "https://vivintsky.com/api/" + this.panelId + "/" + this.parId + uri
    }

    putDevice(category, id, data) {
      //In case of Alarm panel there is no id because it is treated on the Panel level
      let uriString = id != null ? 
        "/" + category + "/" + id :
        "/" + category

      //Not sure if this is required at all
      if (id == null) {
        data.systemId = this.panelId
        data.partitionId = this.parId
      }

      return request({
        url: this.getPanelUrl(uriString),
        method: "PUT",
        body: JSON.stringify(data),
        headers: { Cookie: this.cookie }
      })
    }
  }

  VivintApi.doAuth = (creds) => {
    let loginRequest = request({
      method: "POST",
      url: "https://vivintsky.com/api/login",
      body: JSON.stringify(creds)
    })
    return loginRequest.then((r) => {
      let sessionInfo = JSON.parse(r)
      let cookie = loginRequest.responseContent.headers["set-cookie"][0].split(";")[0]

      return {sessionInfo: sessionInfo, cookie: cookie}
    })
  }

  VivintApi.getSystemInfo = (cookie, panelId) =>
    request({
      "url": "https://vivintsky.com/api/systems/" + panelId,
      "headers": {
        "Cookie": cookie
      }
    }).then(JSON.parse)


  VivintApi.login = (creds) => {
    return VivintApi.doAuth(creds).then((result) => {
      let sessionInfo = result.sessionInfo
      let cookie = result.cookie
      let panelId = sessionInfo.u.system[0].panid

      return VivintApi.getSystemInfo(cookie, panelId).then((sysInfo) => {
        return new VivintApi(creds, panelId, cookie, sessionInfo, sysInfo)
      })
    })
  }

  return VivintApi;
}

module.exports = VivintApiModule
