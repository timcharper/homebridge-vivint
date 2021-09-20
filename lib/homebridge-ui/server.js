"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-console */
const plugin_ui_utils_1 = require("@homebridge/plugin-ui-utils");
const vivint_mfa_1 = require("../../lib/vivint_mfa");
class PluginUiServer extends plugin_ui_utils_1.HomebridgePluginUiServer {
    constructor() {
        super();
        const vivint_mfa = new vivint_mfa_1.VivintMFA();
        let cookie = "";
        this.generateCode = ({ email, password }) => __awaiter(this, void 0, void 0, function* () {
            console.log(`Logging in with email '${email}'`);

            try {
                cookie = yield vivint_mfa.MFALogin(email, password);
                if (vivint_mfa.using2fa) {
                    return { codePrompt: vivint_mfa.promptFor2fa };
                } else {
                    // If we get here, 2fa was not required.
                    return { refreshToken: cookie };
                }
            }
            catch (e) {
                console.error(e);
                throw new plugin_ui_utils_1.RequestError(e.message, e);
            }
        });

        this.generateToken = ({ email, password, code }) => __awaiter(this, void 0, void 0, function* () {
            console.log(`Getting token for ${email} with code ${code}`);
            try {
                const generateTokenResponse = yield vivint_mfa.MFAValidateCode(cookie,code)
                return { refreshToken: cookie };
            }
            catch (e) {
                console.error('Incorrect 2fa Code');
                throw new plugin_ui_utils_1.RequestError('Please check the code and try again', e);
            }
        });
        //These route the incomming requests to the correct function
        this.onRequest('/send-code', this.generateCode);
        this.onRequest('/token', this.generateToken);
        this.ready();
    }
}
function startPluginUiServer() {
    return new PluginUiServer();
}
startPluginUiServer();
