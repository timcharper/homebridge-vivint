const request = require("request-promise-native")
const PubNub = require('pubnub')
const extend = require('util')._extend

function VivintApiModule(config, log) {
  let apiLoginRefreshSecs = config.apiLoginRefreshSecs || 1200 // once per 20 minutes default

  class VivintApi {
    constructor(creds, panelId, cookie, sessionInfo, systemInfo) {
      this.creds = creds
      this.panelId = panelId
      this.parId = systemInfo.system.par[0].parid
      this.cookie = cookie
      this.sessionInfo = sessionInfo
      this.systemInfo = systemInfo
      this.renewInterval = setInterval(() => this.renew(), apiLoginRefreshSecs * 1000)
    }

    renew() {
      let self = this
      VivintApi.doAuth(this.creds).then(
        (result) => {
          log("Renewed Vivint API session. ", self.cookie, result.cookie)
          self.cookie = result.cookie
          self.sessionInfo = result.sessionInfo
        },
        (error) => {
          console.log("error renewing login", error)
          setTimeout(() => { renew() }, 5000)
        }
      )
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
      return request({
        url: this.getPanelUrl("/" + category + "/" + id),
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

  VivintApi.login = (creds) => {
    return VivintApi.doAuth(creds).then((result) => {
      let sessionInfo = result.sessionInfo
      let cookie = result.cookie
      let panelId = sessionInfo.u.system[0].panid

      let systemInfo = request({
        "url": "https://vivintsky.com/api/systems/" + panelId,
        "headers": {
          "Cookie": cookie
        }
      })

      return systemInfo.then((sysInfo) => {
        return new VivintApi(creds, panelId, cookie, sessionInfo, JSON.parse(sysInfo))
      })
    })
  }

  return VivintApi;
}

module.exports = VivintApiModule
