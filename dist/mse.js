"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMSE = exports.MSERep = void 0;
const peptalk_1 = require("./peptalk");
const events_1 = require("events");
const xml_1 = require("./xml");
const rundown_1 = require("./rundown");
const uuid = require("uuid");
const uuidRe = /[a-fA-f0-9]{8}-[a-fA-f0-9]{4}-[a-fA-f0-9]{4}-[a-fA-f0-9]{4}-[a-fA-f0-9]{12}/;
class MSERep extends events_1.EventEmitter {
    constructor(hostname, restPort, wsPort, resthost) {
        super();
        this.connection = undefined;
        this.reconnectTimeout = undefined;
        this.lastConnectionAttempt = undefined;
        this.timeoutMS = 3000;
        this.hostname = hostname;
        this.restPort = typeof restPort === 'number' && restPort > 0 ? restPort : 8580;
        this.wsPort = typeof wsPort === 'number' && wsPort > 0 ? wsPort : 8595;
        this.resthost = resthost; // For ngrok testing only
        this.pep = this.initPep();
    }
    initPep() {
        if (this.pep) {
            this.pep.removeAllListeners();
        }
        const pep = peptalk_1.startPepTalk(this.hostname, this.wsPort);
        pep.on('close', () => this.onPepClose());
        this.lastConnectionAttempt = Date.now();
        this.connection = pep.connect().catch((e) => e);
        return pep;
    }
    async onPepClose() {
        var _a;
        if (!this.reconnectTimeout) {
            this.connection = undefined;
            this.reconnectTimeout = setTimeout(() => {
                this.reconnectTimeout = undefined;
                this.pep = this.initPep();
            }, Math.max(2000 - (Date.now() - ((_a = this.lastConnectionAttempt) !== null && _a !== void 0 ? _a : 0)), 0));
        }
    }
    async checkConnection() {
        if (this.connection) {
            await this.connection;
        }
        else {
            throw new Error('Attempt to connect to PepTalk server failed.');
        }
    }
    getPep() {
        return this.pep;
    }
    // private readonly sofieShowRE = /<entry name="sofie_show">\/storage\/shows\/\{([^\}]*)\}<\/entry>/
    async getRundowns() {
        await this.checkConnection();
        const playlistList = await this.pep.getJS('/storage/playlists', 3);
        const atomEntry = playlistList.js;
        // Horrible hack ... playlists not following atom pub model
        if (atomEntry.entry) {
            atomEntry.entry.entry = atomEntry.entry.playlist;
            delete atomEntry.entry.playlist;
        }
        const flatList = await xml_1.flattenEntry(playlistList.js);
        return Object.keys(flatList)
            .filter((k) => k !== 'name' && typeof flatList[k] !== 'string' && flatList[k].sofie_show)
            .map((k) => new rundown_1.Rundown(this, flatList[k].sofie_show.value, flatList[k].profile, k, flatList[k].description));
    }
    async getRundown(playlistID) {
        const playlist = await this.getPlaylist(playlistID);
        if (!playlist.sofie_show) {
            throw new Error('Cannnot retrieve a rundown witnout a sofie show property.');
        }
        return new rundown_1.Rundown(this, playlist.sofie_show.value, playlist.profile, playlistID, playlist.description);
    }
    async getEngines() {
        await this.checkConnection();
        const handlers = await this.pep.getJS('/scheduler');
        const handlersBody = handlers.js;
        // Sometimes the main node is is called 'scheduler', sometimes 'entry'
        // It doesn't seem to depend on specific version, so let's just support both
        const vizEntries = (handlersBody.entry || handlersBody.scheduler).handler.filter((x) => x.$.type === 'viz');
        const viz = await Promise.all(vizEntries.map((x) => xml_1.flattenEntry(x)));
        return viz;
    }
    async listProfiles() {
        await this.checkConnection();
        const profileList = await this.pep.getJS('/config/profiles', 1);
        const flatList = await xml_1.flattenEntry(profileList.js);
        return Object.keys(flatList).filter((x) => x !== 'name');
    }
    async getProfile(profileName) {
        await this.checkConnection();
        const profile = await this.pep.getJS(`/config/profiles/${profileName}`);
        const flatProfile = await xml_1.flattenEntry(profile.js);
        return flatProfile;
    }
    async listShows() {
        await this.checkConnection();
        const showList = await this.pep.getJS('/storage/shows', 1);
        const flatList = await xml_1.flattenEntry(showList.js);
        return Object.keys(flatList).filter((x) => x !== 'name');
    }
    async getShow(showName) {
        if (!showName.startsWith('{')) {
            showName = '{' + showName;
        }
        if (!showName.endsWith('}')) {
            showName = showName + '}';
        }
        if (!showName.match(uuidRe)) {
            return Promise.reject(new Error(`Show name must be a UUID and '${showName}' is not.`));
        }
        await this.checkConnection();
        const show = await this.pep.getJS(`/storage/shows/${showName}`);
        const flatShow = await xml_1.flattenEntry(show.js);
        return flatShow;
    }
    async listPlaylists() {
        await this.checkConnection();
        const playlistList = await this.pep.getJS('/storage/playlists', 1);
        const atomEntry = playlistList.js;
        // Horrible hack ... playlists not following atom pub model
        if (atomEntry.entry) {
            atomEntry.entry.entry = atomEntry.entry.playlist;
            delete atomEntry.entry.playlist;
        }
        const flatList = await xml_1.flattenEntry(playlistList.js);
        return Object.keys(flatList).filter((x) => x !== 'name');
    }
    async getPlaylist(playlistName) {
        if (!playlistName.startsWith('{')) {
            playlistName = '{' + playlistName;
        }
        if (!playlistName.endsWith('}')) {
            playlistName = playlistName + '}';
        }
        if (!playlistName.match(uuidRe)) {
            return Promise.reject(new Error(`Playlist name must be a UUID and '${playlistName}' is not.`));
        }
        await this.checkConnection();
        const playlist = await this.pep.getJS(`/storage/playlists/${playlistName}`);
        let flatPlaylist = await xml_1.flattenEntry(playlist.js);
        if (Object.keys(flatPlaylist).length === 1) {
            flatPlaylist = flatPlaylist[Object.keys(flatPlaylist)[0]];
        }
        return flatPlaylist;
    }
    // Rundown basics task
    async createRundown(showID, profileName, playlistID, description) {
        let playlistExists = false;
        showID = showID.toUpperCase();
        const date = new Date();
        description = description ? description : `Sofie Rundown ${date.toISOString()}`;
        try {
            await this.checkConnection();
            await this.pep.get(`/storage/shows/{${showID}}`, 1);
        }
        catch (err) {
            throw new Error(`The request to create a rundown for a show with ID '${showID}' failed. Error is: ${err.message}.`);
        }
        try {
            await this.pep.get(`/config/profiles/${profileName}`, 1);
        }
        catch (err) {
            throw new Error(`The profile with name '${profileName}' for a new rundown does not exist. Error is: ${err.message}.`);
        }
        if (playlistID) {
            try {
                const playlist = await this.getPlaylist(playlistID.toUpperCase());
                if (!playlist.profile.endsWith(`/${profileName}`)) {
                    throw new Error(`Referenced playlist exists but references profile '${playlist.profile}' rather than the given '${profileName}'.`);
                }
                playlistExists = true;
            }
            catch (err) {
                if (err.message.startsWith('Referenced playlist exists but')) {
                    throw err;
                }
                playlistExists = false;
            }
        }
        if (!playlistExists) {
            playlistID = playlistID && playlistID.match(uuidRe) ? playlistID.toUpperCase() : uuid.v4().toUpperCase();
            const modifiedDate = `${date.getUTCDate().toString().padStart(2, '0')}.${(date.getUTCMonth() + 1)
                .toString()
                .padStart(2, '0')}.${date.getFullYear()} ${date
                .getHours()
                .toString()
                .padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date
                .getSeconds()
                .toString()
                .padStart(2, '0')}`;
            await this.pep.insert(`/storage/playlists/{${playlistID}}`, `<playlist description="${description}" modified="${modifiedDate}" profile="/config/profiles/${profileName}" name="{${playlistID}}">
    <elements/>
    <entry name="environment">
        <entry name="alternative_concept"/>
    </entry>
    <entry name="cursors">
        <entry name="globals">
            <entry name="last_taken"/>
            <entry name="last_read"/>
        </entry>
    </entry>
    <entry backing="transient" name="active_profile"/>
    <entry name="meta"/>
    <entry name="settings"/>
    <entry name="ncs_cursor"/>
		<entry name="sofie_show">/storage/shows/{${showID}}</entry>
</playlist>`, peptalk_1.LocationType.Last);
        }
        return new rundown_1.Rundown(this, showID, profileName, playlistID, description);
    }
    // Rundown basics task
    async deleteRundown(rundown) {
        const playlist = await this.getPlaylist(rundown.playlist);
        // console.dir(playlist, { depth: 10 })
        if (playlist.active_profile.value) {
            throw new Error(`Cannot delete an active profile.`);
        }
        const delres = await this.pep.delete(`/storage/playlists/{${rundown.playlist}}`);
        return delres.status === 'ok';
    }
    // Advanced feature
    createProfile(_profileName, _profileDetailsTbc) {
        return Promise.reject(new Error('Not implemented. Creating profiles is a future feature.'));
    }
    // Advanced feature
    deleteProfile(_profileName) {
        return Promise.reject(new Error('Not implemented. Deleting profiles ia a future feature.'));
    }
    async ping() {
        try {
            const res = await this.pep.ping();
            return { path: 'ping', status: 200, response: res.body };
        }
        catch (err) {
            err.path = 'ping';
            err.status = 418;
            err.response = err.message;
            throw err;
        }
    }
    async close() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }
        if (this.connection) {
            await this.pep.close();
            return true;
        }
        return false;
    }
    timeout(t) {
        if (typeof t !== 'number')
            return this.timeoutMS;
        return this.pep.setTimeout(t);
    }
}
exports.MSERep = MSERep;
/**
 *  Factory to create an [[MSE]] instance to manage commumication between a Node
 *  application and a Viz Media Sequencer Engine.
 *  @param hostname Hostname or IP address for the instance of the MSE to control.
 *  @param restPort Optional port number for HTTP traffic, is different from the
 *                  default of 8580.
 *  @param wsPort   Optional port number for PepTalk traffic over websockets, if
 *                  different from the default of 8695.
 *  @param resthost Optional different host name for rest connection - for testing
 *                  purposes only.
 *  @return New MSE that will start to initialize a connection based on the parameters.
 */
function createMSE(hostname, restPort, wsPort, resthost) {
    return new MSERep(hostname, restPort, wsPort, resthost);
}
exports.createMSE = createMSE;
// let sleep = (t: number) => new Promise((resolve, _reject) => {
// 	setTimeout(resolve, t)
// })
//
// async function run () {
// 	let mse = createMSE('mse_ws.ngrok.io', 80, 80, 'mse_http.ngrok.io')
// 	let rundown = await mse.createRundown('66E45216-9476-4BDC-9556-C3DB487ED9DF', 'SOFIE')
// 	await rundown.createElement(2552305, 'FULL1')
// 	try { await rundown.activate() } catch (err) { /* */ }
// 	await sleep(5000)
// 	console.log('Taking now')
// 	rundown.take(2552305)
// 	await rundown.createElement(2565133, 'FULL1')
// 	await sleep(3000)
// 	rundown.take(2565133)
// 	await mse.close()
// 	// console.log('After close.')
// }
//
// run().catch(console.error)
//# sourceMappingURL=mse.js.map