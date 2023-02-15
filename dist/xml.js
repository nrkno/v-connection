"use strict";
/**
 *  Utility functions for transforming AtomPub XML to Javascript objects.
 *
 *  Relevant specifications include [RFC5023](https://tools.ietf.org/html/rfc5023)
 *  and [RFC4287](https://tools.ietf.org/html/rfc4287).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toFlatMap = exports.buildXML = exports.entry2XML = exports.flattenEntry = void 0;
const Xml2JS = require("xml2js");
/**
 *  Transform a direct-from-XML format [[AtomEntry|atom pub entry]] into its flatter,
 *  easier to process form.
 *  @param atomEntry Source atom pub entry.
 *  @return Simplified version of `x`.
 */
async function flattenEntry(atomEntry) {
    const keys = Object.keys(atomEntry);
    if (keys.length === 1 && (atomEntry.entry || atomEntry.ref)) {
        return flattenEntry((atomEntry.entry ? atomEntry.entry : atomEntry.ref));
    }
    let y = {};
    if (atomEntry.$) {
        for (const a in atomEntry.$) {
            y[a] = atomEntry.$[a];
        }
    }
    if (atomEntry._) {
        y.value = atomEntry._;
    }
    // MSE uses entries with nested sub-entries. Not Atom-compliant, but fairly consistent
    if (atomEntry.entry && Array.isArray(atomEntry.entry)) {
        let unnamedCount = 0;
        for (const e of atomEntry.entry) {
            if (typeof e === 'object') {
                if (e.$ && e.$.name) {
                    if (e.$.name === 'model_xml') {
                        try {
                            y[e.$.name] = e._ ? await Xml2JS.parseStringPromise(e._) : '';
                        }
                        catch (err) {
                            y[e.$.name] = e._;
                        }
                    }
                    else {
                        y[e.$.name] = await flattenEntry(e);
                    }
                    delete y[e.$.name].name;
                }
                else {
                    y[`_entry#${unnamedCount++}`] = await flattenEntry(e);
                }
            }
            else {
                if (!y.value) {
                    y = { value: [] };
                }
                y.value.push(e);
            }
        }
    }
    // Apart from when a _special_ XML element name is used. This code picks up those with different _keys_.
    for (const k of keys.filter((z) => z !== 'entry' && z !== '$' && z !== '_')) {
        if (typeof atomEntry[k] === 'object') {
            if (Array.isArray(atomEntry[k])) {
                await Promise.all(atomEntry[k].map(async (z) => {
                    if (typeof z === 'object') {
                        if (z.$ && z.$.name) {
                            y[z.$.name] = await flattenEntry(z);
                            y[z.$.name].key = k;
                            delete y[z.$.name].name;
                        }
                        else {
                            if (!y[k]) {
                                y[k] = [];
                                y[`${k}_key`] = k;
                            }
                            y[k].push(await flattenEntry(z));
                        }
                    }
                    if (typeof z === 'string') {
                        y[k] = { value: z, key: k };
                    }
                }));
            }
            else {
                const e = atomEntry[k];
                if (e.$ && e.$.name) {
                    y[e.$.name] = await flattenEntry(e);
                    y[e.$.name].key = k;
                    delete y[e.$.name].name;
                }
                else {
                    y[k] = await flattenEntry(e);
                }
            }
        }
    }
    return y;
}
exports.flattenEntry = flattenEntry;
/**
 *  Tranform a simplified version of an [[AtomEntry|atom pub entry]] into its
 *  ready-to-be-build form.
 *  Note that the implementation of this is not complete. For expediancy, XML
 *  strings are build manually when required within the code.
 *  @param flatEntry Source simplified object.
 *  @return Ready for XML building version of `x`.
 */
function entry2XML(flatEntry) {
    if (Object.keys(flatEntry).length === 0)
        return { $: {} };
    const y = { $: {}, entry: [] };
    for (const a in flatEntry) {
        // console.log(a, typeof(x[a]), x[a])
        if (typeof flatEntry[a] === 'object') {
            const e = entry2XML(flatEntry[a]);
            // console.log('EEE >>>', a, x[a], e)
            if (!a.startsWith('_')) {
                e.$.name = a;
            }
            if (e.$.value && e.$.key) {
                delete e.$.key;
            }
            if (e.entry && e.$.value && Array.isArray(e.entry) && e.entry.length === 0) {
                e._ = e.$.value;
                delete e.$.value;
                delete e.entry;
            }
            else if (e.entry && Array.isArray(e.entry) && e.entry[0] && e.entry[0].$) {
                let counter = 0;
                const ed = [];
                while (typeof e.entry[0].$[counter.toString()] === 'string') {
                    ed.push(e.entry[0].$[counter.toString()]);
                    counter++;
                }
                if (ed.length > 0) {
                    e.entry = ed;
                }
            }
            y.entry.push(e);
        }
        else {
            y.$[a] = flatEntry[a];
        }
    }
    return y;
}
exports.entry2XML = entry2XML;
/**
 *  Build a Javascript representation of an [[AtomEntry|atom pub entry]] into
 *  and serialize it as a string.
 *  @param atomEntry Atom pub entry to build.
 *  @return Seialized XML representation of `x`.
 */
function buildXML(atomEntry) {
    const builder = new Xml2JS.Builder({ headless: true });
    return builder.buildObject({ entry: atomEntry });
}
exports.buildXML = buildXML;
/**
 *  Build a Map containing paths and their contents
 *  @param atomEntry Source atom pub entry.
 *  @return a Map where keys are paths, and values are the contents of the entries
 */
async function toFlatMap(atomEntry) {
    const result = new Map();
    const flatEntry = await flattenEntry(atomEntry);
    fillMapWithFlatEntryValues(result, flatEntry, '');
    return result;
}
exports.toFlatMap = toFlatMap;
function fillMapWithFlatEntryValues(outputMap, flatEntry, path) {
    for (const key in flatEntry) {
        if (key === 'name' || flatEntry[key] === undefined)
            continue;
        if (key === 'value' && typeof flatEntry['value'] === 'string') {
            outputMap.set(path, flatEntry['value']);
            return;
        }
        if (typeof flatEntry[key] === 'object') {
            fillMapWithFlatEntryValues(outputMap, flatEntry[key], `${path}${path && '/'}${key}`);
        }
    }
}
//# sourceMappingURL=xml.js.map