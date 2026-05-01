const VIEWPORT_OPTIONS = [
  { key: 'XENEON_S_H', label: 'XENEON S-H', width: 840, height: 344 },
  { key: 'XENEON_M_H', label: 'XENEON M-H', width: 840, height: 696 },
  { key: 'XENEON_L_H', label: 'XENEON L-H', width: 1688, height: 696 },
  { key: 'XENEON_XL_H', label: 'XENEON XL-H', width: 2536, height: 696 },
  { key: 'XENEON_S_V', label: 'XENEON S-V', width: 696, height: 416 },
  { key: 'XENEON_M_V', label: 'XENEON M-V', width: 696, height: 840 },
  { key: 'XENEON_L_V', label: 'XENEON L-V', width: 696, height: 1688 },
  { key: 'XENEON_XL_V', label: 'XENEON XL-V', width: 696, height: 2536 }
];

const VIEWPORTS = Object.fromEntries(VIEWPORT_OPTIONS.map((option) => [option.key, { width: option.width, height: option.height }]));
const DEFAULT_VIEWPORT_KEY = 'XENEON_L_H';

const MAX_CLIENT_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_LIBRARY_WIDGET_BYTES = 18 * 1024 * 1024;
const MIN_STORAGE_HEADROOM_BYTES = 5 * 1024 * 1024;

const DB_NAME = 'xeneon-widget-preview';
const DB_VERSION = 1;
const DB_WIDGET_STORE = 'widgets';

const MIME_BY_EXT = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  txt: 'text/plain; charset=utf-8'
};

const widgetFileInput = document.getElementById('widgetFile');
const uploadButton = document.getElementById('uploadButton');
const clearLibraryButton = document.getElementById('clearLibraryButton');
const widgetLibrary = document.getElementById('widgetLibrary');
const libraryCount = document.getElementById('libraryCount');
const libraryMessage = document.getElementById('libraryMessage');

const viewportSelect = document.getElementById('viewportSelect');
const activeWidgetName = document.getElementById('activeWidgetName');
const activeViewportLabel = document.getElementById('activeViewportLabel');
const frameDimensions = document.getElementById('frameDimensions');
const statusMessage = document.getElementById('statusMessage');
const assetWarning = document.getElementById('assetWarning');
const reloadPreviewButton = document.getElementById('reloadPreviewButton');
const frameCanvas = document.getElementById('frameCanvas');
const frameStage = document.getElementById('frameStage');
const frameScaler = document.getElementById('frameScaler');
const widgetFrame = document.getElementById('widgetFrame');
const emptyState = document.getElementById('emptyState');

const validationBadge = document.getElementById('validationBadge');
const validationSummary = document.getElementById('validationSummary');
const validationDetails = document.getElementById('validationDetails');
const validationDetailsWrap = document.getElementById('validationDetailsWrap');
const toggleValidationButton = document.getElementById('toggleValidationButton');
const revalidateButton = document.getElementById('revalidateButton');
const deleteWidgetButton = document.getElementById('deleteWidgetButton');
const previewTabButton = document.getElementById('previewTabButton');
const settingsTabButton = document.getElementById('settingsTabButton');
const packageTabButton = document.getElementById('packageTabButton');
const previewTabPanel = document.getElementById('previewTabPanel');
const settingsTabPanel = document.getElementById('settingsTabPanel');
const packageTabPanel = document.getElementById('packageTabPanel');
const settingsSummary = document.getElementById('settingsSummary');
const externalWarning = document.getElementById('externalWarning');
const settingsList = document.getElementById('settingsList');
const resetSettingsButton = document.getElementById('resetSettingsButton');
const proxyEnabledInput = document.getElementById('proxyEnabledInput');
const proxyWarning = document.getElementById('proxyWarning');

const infoName = document.getElementById('infoName');
const infoVersion = document.getElementById('infoVersion');
const infoId = document.getElementById('infoId');
const infoFileCount = document.getElementById('infoFileCount');
const infoSource = document.getElementById('infoSource');
const infoCli = document.getElementById('infoCli');

let currentSessionId = null;
let loadedManifest = null;
let layouts = [];
let activeLayoutIndex = 0;
let serviceWorkerRegistrationPromise = null;
let widgetAssetWarnings = [];
let previewReloadNonce = 0;
let libraryRecords = [];
let currentWidgetRecordId = null;
let currentLoadedWidgetBytes = null;
let currentLoadedFileName = '';
let currentPackageFileCount = null;
let currentValidationState = null;
let currentValidationMeta = null;
let activeInspectorTab = 'preview';
let validationDetailsExpanded = false;
let currentRuntimeSettings = createEmptyRuntimeSettings();
let libraryMessageTimeout = null;
let currentExternalResourceWarning = '';
let currentExternalDomains = [];
let currentArchiveFiles = [];
let currentTextEntries = new Map();
let frameUpdateSequence = 0;
let registeredWidgetSessionId = null;
let currentPreviewObjectUrls = [];
let activeUploadToken = 0;

const SERVICE_WORKER_RELOAD_KEY = 'xeneon-widget-preview-sw-reload-once';
const PREVIEW_ROUTING_FAILURE_MESSAGE = 'Preview routing failed. The hosted app shell was returned instead of widget HTML. Clear site data and reload, or check Service Worker registration.';
const BUILDER_APP_SHELL_MARKERS = [
  'widget asset not available',
  'xeneon edge',
  'widget builder',
  'upload .icuewidget',
  'preview.js'
];
const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; object-src blob:; frame-src blob:; worker-src blob:; base-uri 'none'; form-action 'none'";

function createEmptyValidationState(summary = 'No validation run yet.') {
  return {
    level: 'neutral',
    badge: 'Idle',
    summary,
    details: '',
    source: null,
    cliAvailable: null,
    fileCount: null,
    widgetName: null,
    widgetVersion: null
  };
}

function createEmptyRuntimeSettings() {
  return {
    definitionsByLayout: {},
    values: {},
    proxyEnabled: false
  };
}

function createStorageError(message) {
  const error = new Error(message);
  error.isStorageGuard = true;
  return error;
}

function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function decodeHtmlEntities(value) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(value ?? '');
  return textarea.value;
}

function normalizeIcueString(value) {
  if (value == null) return '';
  let normalized = decodeHtmlEntities(String(value).trim());
  normalized = normalized.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const trMatch = normalized.match(/^tr\((['"])([\s\S]*)\1\)$/i);
  if (trMatch) normalized = trMatch[2];
  const quoteMatch = normalized.match(/^(['"])([\s\S]*)\1$/);
  if (quoteMatch) normalized = quoteMatch[2];
  return normalized.trim();
}

function toSlugLabel(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMaybeNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMaybeBoolean(value) {
  if (value == null) return null;
  const normalized = normalizeIcueString(value).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function normalizeColorValue(value) {
  const normalized = normalizeIcueString(value);
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized) ? normalized : '';
}

function parseOptionList(value) {
  const normalized = normalizeIcueString(value);
  if (!normalized) return [];
  if ((normalized.startsWith('[') && normalized.endsWith(']')) || (normalized.startsWith('{') && normalized.endsWith('}'))) {
    try {
      const parsed = JSON.parse(normalized);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => {
          if (item && typeof item === 'object') {
            const rawValue = normalizeIcueString(item.value ?? item.key ?? item.label ?? '');
            const rawLabel = normalizeIcueString(item.label ?? item.value ?? item.key ?? '');
            return { label: rawLabel || rawValue, value: rawValue || rawLabel };
          }
          const token = normalizeIcueString(item);
          return { label: token, value: token };
        }).filter((entry) => entry.value || entry.label);
      }
    } catch {
      // fall through to token splitting
    }
  }
  const tokens = normalized.split(/\s*(?:\||;|,)\s*/).map((item) => normalizeIcueString(item)).filter(Boolean);
  return tokens.map((token) => ({ label: token, value: token }));
}

function getMetaContent(meta, ...names) {
  for (const name of names) {
    const attrValue = meta.getAttribute(name);
    if (attrValue != null) return attrValue;
  }
  return null;
}

function buildSettingDefinition(meta, fallbackIndex) {
  const propertyName = normalizeIcueString(getMetaContent(
    meta,
    'content',
    'property-name',
    'property',
    'name',
    'id',
    'data-property-name',
    'data-name'
  ));
  if (!propertyName || propertyName === 'x-icue-property') return null;

  const type = normalizeIcueString(getMetaContent(
    meta,
    'property-type',
    'type',
    'control',
    'ui',
    'data-property-type',
    'data-type'
  )).toLowerCase() || 'unknown';
  const normalizedType = type === 'switch' ? 'checkbox' : type;

  const label = normalizeIcueString(getMetaContent(
    meta,
    'property-label',
    'label',
    'title',
    'caption',
    'display-name',
    'data-label'
  )) || toSlugLabel(propertyName) || `Setting ${fallbackIndex}`;

  const definition = {
    id: propertyName,
    name: propertyName,
    label,
    type: normalizedType,
    defaultValue: normalizeIcueString(getMetaContent(meta, 'default', 'default-value', 'value', 'data-default')),
    min: parseMaybeNumber(getMetaContent(meta, 'min', 'minimum', 'data-min')),
    max: parseMaybeNumber(getMetaContent(meta, 'max', 'maximum', 'data-max')),
    step: parseMaybeNumber(getMetaContent(meta, 'step', 'data-step')),
    unitLabel: normalizeIcueString(getMetaContent(meta, 'unit-label', 'unit', 'suffix', 'data-unit-label')),
    mediaFilters: normalizeIcueString(getMetaContent(meta, 'media-filters', 'media-filter', 'accept', 'data-media-filters')),
    options: [],
    raw: {}
  };

  for (const attr of meta.attributes) {
    definition.raw[attr.name] = attr.value;
  }

  const options = parseOptionList(getMetaContent(
    meta,
    'option-values',
    'options',
    'values',
    'items',
    'data-options',
    'data-values',
    'data-option-values'
  ));
  const optionLabels = parseOptionList(getMetaContent(
    meta,
    'option-labels',
    'labels',
    'data-option-labels',
    'data-labels'
  ));
  definition.options = options.map((option, index) => ({
    value: option.value,
    label: optionLabels[index]?.label || option.label
  }));

  return definition;
}

function parseWidgetSettingsFromHtml(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const metas = [...doc.querySelectorAll('meta[name="x-icue-property"]')];
  return metas.map((meta, index) => buildSettingDefinition(meta, index + 1)).filter(Boolean);
}

function getCurrentLayoutDefinitions() {
  const layoutId = getCurrentLayoutId();
  return layoutId ? (currentRuntimeSettings.definitionsByLayout?.[layoutId] || []) : [];
}

function normalizePreviewRedditJsonUrl(rawValue) {
  const value = normalizeIcueString(rawValue);
  if (!value) return value;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== 'reddit.com' && hostname !== 'www.reddit.com') return value;
  if (/\/\.json$/i.test(parsed.pathname)) return parsed.toString();

  const normalizedPath = parsed.pathname.replace(/\/([^/]+)\.json$/i, '/$1/.json');
  if (normalizedPath === parsed.pathname) return value;

  parsed.pathname = normalizedPath;
  return parsed.toString();
}

function getSettingHintText(definition, currentValue) {
  if (definition.type !== 'textfield') return '';
  const normalizedValue = normalizePreviewRedditJsonUrl(currentValue);
  if (!normalizedValue) return '';

  let parsed;
  try {
    parsed = new URL(normalizedValue);
  } catch {
    return '';
  }

  const hostname = parsed.hostname.toLowerCase();
  if ((hostname === 'reddit.com' || hostname === 'www.reddit.com') && /\/\.json$/i.test(parsed.pathname)) {
    return 'Reddit JSON preview tip: prefer <code>/.json</code> endpoints if Reddit returns HTML instead of JSON.';
  }
  return '';
}

function normalizeSettingValue(definition, rawValue) {
  if (definition.type === 'checkbox') {
    const boolValue = parseMaybeBoolean(rawValue);
    return boolValue == null ? false : boolValue;
  }
  if (definition.type === 'slider') {
    const fallback = parseMaybeNumber(definition.defaultValue) ?? definition.min ?? 0;
    const parsed = parseMaybeNumber(rawValue);
    return parsed == null ? fallback : parsed;
  }
  return normalizePreviewRedditJsonUrl(rawValue != null && rawValue !== '' ? rawValue : definition.defaultValue);
}

function ensureWidgetSettingDefaults() {
  const nextValues = { ...currentRuntimeSettings.values };
  let changed = false;
  for (const definitions of Object.values(currentRuntimeSettings.definitionsByLayout || {})) {
    for (const definition of definitions) {
      const normalizedValue = normalizeSettingValue(
        definition,
        definition.name in nextValues ? nextValues[definition.name] : definition.defaultValue
      );
      if (!(definition.name in nextValues) || !Object.is(nextValues[definition.name], normalizedValue)) {
        nextValues[definition.name] = normalizedValue;
        changed = true;
      }
    }
  }
  if (changed) {
    currentRuntimeSettings = {
      ...currentRuntimeSettings,
      values: nextValues
    };
  }
}

function getCurrentWidgetRuntimeSnapshot() {
  return {
    definitionsByLayout: deepClone(currentRuntimeSettings.definitionsByLayout || {}),
    values: deepClone(currentRuntimeSettings.values || {}),
    proxyEnabled: Boolean(currentRuntimeSettings.proxyEnabled)
  };
}

function getLayoutRuntimePayload() {
  const layoutDefinitions = getCurrentLayoutDefinitions();
  const settings = {};
  for (const definition of layoutDefinitions) {
    settings[definition.name] = normalizeSettingValue(definition, currentRuntimeSettings.values?.[definition.name]);
  }
  return {
    settings,
    definitions: layoutDefinitions.map((definition) => ({
      name: definition.name,
      label: definition.label,
      type: definition.type,
      unitLabel: definition.unitLabel,
      mediaFilters: definition.mediaFilters,
      options: definition.options
    })),
    proxyEnabled: Boolean(currentRuntimeSettings.proxyEnabled),
    layoutId: getCurrentLayoutId()
  };
}

function serializeForInlineScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildPreviewSecurityMeta() {
  return `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
}

function buildPreviewRuntimeBridge(runtimePayload) {
  const payload = serializeForInlineScript(runtimePayload);
  // Bridge is injected at the start of <head>, before any widget scripts.
  // Telemetry messages let the parent observe bridge execution without DOM access.
  // icueEvents pattern (e.g. RSS Feed Reader) is supported alongside direct window hooks.
  const bridge = `(function(){
try{
var tell=function(m){try{window.parent.postMessage(m,'*');}catch(_){}};
tell({type:'ICUE_PREVIEW_BRIDGE_READY'});
(function(){
  var lsOk=false;
  try{void window.localStorage;lsOk=true;}catch(_){}
  if(!lsOk){
    var mk=function(){var s=Object.create(null);var o={getItem:function(k){return Object.prototype.hasOwnProperty.call(s,k)?s[k]:null;},setItem:function(k,v){s[k]=String(v);},removeItem:function(k){delete s[k];},clear:function(){for(var k in s)delete s[k];},key:function(i){return Object.keys(s)[i]||null;}};Object.defineProperty(o,'length',{get:function(){return Object.keys(s).length;}});return o;};
    try{Object.defineProperty(window,'localStorage',{value:mk(),configurable:true,writable:true});}catch(_){}
    try{Object.defineProperty(window,'sessionStorage',{value:mk(),configurable:true,writable:true});}catch(_){}
    tell({type:'ICUE_PREVIEW_BRIDGE_READY',shimmed:'localStorage+sessionStorage'});
  }
})();
var initial=${payload};
var clone=function(v){return JSON.parse(JSON.stringify(v||{}));};
var DIRECT_HOOKS=['onIcueInitialized','onIcueDataUpdated'];
var SAFE_ID=/^[A-Za-z_$][A-Za-z0-9_$]*$/;
var BLOCKED=new Set(['__proto__','prototype','constructor','window','document','location','top','parent','self','frames','eval','Function']);
var injectedKeys=[];var lastVals=Object.create(null);
function isSafe(k){return SAFE_ID.test(k)&&!BLOCKED.has(k);}
function mirror(settings){
  var nk=[];
  for(var k of Object.keys(settings||{})){if(isSafe(k))nk.push(k);}
  for(var k of injectedKeys){if(nk.includes(k))continue;if(Object.is(window[k],lastVals[k])){try{delete window[k];}catch(_){}}delete lastVals[k];}
  for(var k of nk){window[k]=settings[k];lastVals[k]=settings[k];}
  injectedKeys=nk;
}
function callHooks(settings){
  for(var h of DIRECT_HOOKS){
    try{if(typeof window[h]==='function'){window[h](settings);tell({type:'ICUE_PREVIEW_HOOK_CALLED',hook:h});}}
    catch(e){tell({type:'ICUE_PREVIEW_BRIDGE_ERROR',message:'hook '+h+': '+String(e&&e.message||e)});}
  }
  try{
    var ev=window.icueEvents;
    if(ev&&typeof ev==='object'){
      if(typeof ev.onDataUpdated==='function'){ev.onDataUpdated(settings);tell({type:'ICUE_PREVIEW_HOOK_CALLED',hook:'icueEvents.onDataUpdated'});}
      if(typeof ev.onICUEInitialized==='function'){ev.onICUEInitialized(settings);tell({type:'ICUE_PREVIEW_HOOK_CALLED',hook:'icueEvents.onICUEInitialized'});}
    }
  }catch(e){tell({type:'ICUE_PREVIEW_BRIDGE_ERROR',message:'icueEvents: '+String(e&&e.message||e)});}
}
function apply(p,invokeHooks){
  try{
    var safe=clone(p);
    var settings=safe.settings&&typeof safe.settings==='object'?safe.settings:{};
    safe.settings=settings;
    window.__ICUE_PREVIEW_SETTINGS__=settings;
    window.__ICUE_PREVIEW_LAYOUT__=safe.layoutId||null;
    window.__ICUE_PREVIEW_PROXY_ENABLED__=!!safe.proxyEnabled;
    mirror(settings);
    try{window.dispatchEvent(new CustomEvent('icue-preview-settings-updated',{detail:safe}));}catch(_){}
    tell({type:'ICUE_PREVIEW_SETTINGS_APPLIED',keys:Object.keys(settings),proxyEnabled:!!safe.proxyEnabled});
    if(!invokeHooks)return;
    callHooks(settings);
  }catch(e){tell({type:'ICUE_PREVIEW_BRIDGE_ERROR',message:String(e&&e.message||e)});}
}
window.addEventListener('message',function(event){
  var d=event.data||{};
  if(d.type==='ICUE_PREVIEW_SETTINGS'){apply(d.payload||{},true);}
});
apply(initial,false);
document.addEventListener('DOMContentLoaded',function(){
  apply({settings:window.__ICUE_PREVIEW_SETTINGS__,layoutId:window.__ICUE_PREVIEW_LAYOUT__,proxyEnabled:window.__ICUE_PREVIEW_PROXY_ENABLED__},true);
},{once:true});
window.addEventListener('load',function(){
  apply({settings:window.__ICUE_PREVIEW_SETTINGS__,layoutId:window.__ICUE_PREVIEW_LAYOUT__,proxyEnabled:window.__ICUE_PREVIEW_PROXY_ENABLED__},true);
},{once:true});
var nativeFetch=window.fetch?window.fetch.bind(window):null;
function proxyFetch(url,accept){
  return new Promise(function(resolve,reject){
    var reqId='proxy-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
    function onMsg(event){
      var d=event.data||{};
      if(d.type!=='ICUE_PREVIEW_PROXY_RESPONSE'||d.requestId!==reqId)return;
      window.removeEventListener('message',onMsg);
      if(d.ok===false){reject(new Error(d.error||'Proxy request failed.'));return;}
      resolve(new Response(d.body||'',{status:d.status||200,statusText:d.statusText||'OK',headers:d.headers||{}}));
    }
    window.addEventListener('message',onMsg);
    window.parent.postMessage({type:'ICUE_PREVIEW_PROXY_REQUEST',requestId:reqId,url:String(url),accept:accept||''},'*');
  });
}
if(nativeFetch){
  window.fetch=function(resource,init){
    var req=resource instanceof Request?resource:new Request(resource,init);
    var tu=req.url||String(resource||'');
    var method=(req.method||(init&&init.method)||'GET').toUpperCase();
    if(window.__ICUE_PREVIEW_PROXY_ENABLED__&&/^https?:/i.test(tu)&&method==='GET'){
      tell({type:'ICUE_PREVIEW_FETCH_INTERCEPTED',url:tu});
      return proxyFetch(tu,req.headers.get('accept')||'');
    }
    return nativeFetch(resource,init);
  };
}
var NativeXHR=window.XMLHttpRequest;
if(NativeXHR){
  window.XMLHttpRequest=function(){
    var xhr=new NativeXHR();
    var proxyUrl='',proxyMethod='GET',useProxy=false,readyState=0;
    var self=this;
    Object.defineProperties(this,{
      readyState:{get:function(){return useProxy?readyState:xhr.readyState;}},
      status:{get:function(){return useProxy?(self._status||0):xhr.status;}},
      statusText:{get:function(){return useProxy?(self._statusText||''):xhr.statusText;}},
      responseText:{get:function(){return useProxy?(self._responseText||''):xhr.responseText;}},
      response:{get:function(){return useProxy?(self._responseText||''):xhr.response;}},
      responseURL:{get:function(){return useProxy?proxyUrl:xhr.responseURL;}}
    });
    this.onreadystatechange=null;this.onload=null;this.onerror=null;
    this.open=function(method,url){
      proxyMethod=String(method||'GET').toUpperCase();
      proxyUrl=String(url||'');
      useProxy=!!window.__ICUE_PREVIEW_PROXY_ENABLED__&&/^https?:/i.test(proxyUrl)&&proxyMethod==='GET';
      if(!useProxy){xhr.open.apply(xhr,arguments);}
    };
    this.setRequestHeader=function(n,v){if(!useProxy){xhr.setRequestHeader(n,v);}};
    this.send=function(body){
      if(!useProxy){
        xhr.onreadystatechange=function(){if(self.onreadystatechange)self.onreadystatechange();};
        xhr.onload=function(){if(self.onload)self.onload();};
        xhr.onerror=function(){if(self.onerror)self.onerror();};
        xhr.send(body);return;
      }
      tell({type:'ICUE_PREVIEW_XHR_INTERCEPTED',url:proxyUrl});
      readyState=1;if(self.onreadystatechange)self.onreadystatechange();
      proxyFetch(proxyUrl,'').then(function(response){
        return response.text().then(function(text){
          self._status=response.status;self._statusText=response.statusText;self._responseText=text;
          readyState=4;
          if(self.onreadystatechange)self.onreadystatechange();
          if(self.onload)self.onload();
        });
      }).catch(function(error){
        self._status=502;self._statusText='Proxy Error';self._responseText=String(error&&error.message||error);
        readyState=4;
        if(self.onreadystatechange)self.onreadystatechange();
        if(self.onerror)self.onerror(error);
      });
    };
    this.abort=function(){if(!useProxy){xhr.abort();}};
  };
}
}catch(e){try{window.parent.postMessage({type:'ICUE_PREVIEW_BRIDGE_ERROR',message:String(e&&e.message||e)},'*');}catch(_){}}
})()`;
  return `<script>${bridge}<\/script>`;
}

function injectPreviewRuntime(htmlText, runtimePayload) {
  const securityMeta = buildPreviewSecurityMeta();
  const bridge = buildPreviewRuntimeBridge(runtimePayload);
  const injection = `${securityMeta}${bridge}`;
  if (/<head[^>]*>/i.test(htmlText)) {
    return htmlText.replace(/<head([^>]*)>/i, `<head$1>${injection}`);
  }
  if (/<body[^>]*>/i.test(htmlText)) {
    return htmlText.replace(/<body([^>]*)>/i, `<body$1>${injection}`);
  }
  return `${injection}${htmlText}`;
}

function setStatusMessage(message) {
  statusMessage.textContent = message;
}

function logPreviewTelemetry(message, ...details) {
  console.log('[XENEON preview]', message, ...details);
}

function logWidgetRegistrationFiles(layoutPath, files) {
  const firstPaths = files.slice(0, 10).map((file) => file.path);
  const layoutFound = files.some((file) => normalizePath(file.path) === layoutPath);
  logPreviewTelemetry('active layoutPath', { layoutPath });
  logPreviewTelemetry('REGISTER_WIDGET file paths', { firstPaths, layoutFound });
}

function assertActiveLayoutRegistered(files) {
  const layoutPath = getActiveLayoutPath();
  logWidgetRegistrationFiles(layoutPath, files);
  if (!layoutPath || !files.some((file) => normalizePath(file.path) === layoutPath)) {
    throw new Error('Widget layout file was not registered in Service Worker cache.');
  }
}

function setLibraryMessage(message = '', level = 'neutral') {
  if (libraryMessageTimeout) {
    window.clearTimeout(libraryMessageTimeout);
    libraryMessageTimeout = null;
  }
  libraryMessage.className = 'sidebar-message';
  if (level === 'pass') libraryMessage.classList.add('status-pass');
  if (level === 'warn') libraryMessage.classList.add('status-warn');
  if (level === 'fail') libraryMessage.classList.add('status-fail');
  libraryMessage.textContent = message;
}

function setTransientLibraryMessage(message, level = 'neutral', timeoutMs = 3000) {
  setLibraryMessage(message, level);
  if (!message) return;
  libraryMessageTimeout = window.setTimeout(() => {
    libraryMessage.textContent = '';
    libraryMessageTimeout = null;
  }, timeoutMs);
}

function setValidationDetailsExpanded(expanded) {
  validationDetailsExpanded = expanded;
  validationDetailsWrap.hidden = !expanded;
  toggleValidationButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  toggleValidationButton.textContent = expanded ? 'Hide Details' : 'Show Details';
}

function switchInspectorTab(tabName) {
  activeInspectorTab = ['preview', 'settings', 'package'].includes(tabName) ? tabName : 'preview';
  const previewActive = activeInspectorTab === 'preview';
  const settingsActive = activeInspectorTab === 'settings';
  const packageActive = activeInspectorTab === 'package';

  previewTabButton.classList.toggle('is-active', previewActive);
  previewTabButton.setAttribute('aria-selected', previewActive ? 'true' : 'false');
  previewTabPanel.hidden = !previewActive;

  settingsTabButton.classList.toggle('is-active', settingsActive);
  settingsTabButton.setAttribute('aria-selected', settingsActive ? 'true' : 'false');
  settingsTabPanel.hidden = !settingsActive;

  packageTabButton.classList.toggle('is-active', packageActive);
  packageTabButton.setAttribute('aria-selected', packageActive ? 'true' : 'false');
  packageTabPanel.hidden = !packageActive;
}

function updateActionButtons() {
  const hasSelection = Boolean(currentWidgetRecordId);
  revalidateButton.disabled = !currentLoadedWidgetBytes;
  deleteWidgetButton.disabled = !hasSelection;
  reloadPreviewButton.disabled = !currentSessionId;
  toggleValidationButton.disabled = !currentValidationState?.details;
  resetSettingsButton.disabled = !getCurrentLayoutDefinitions().length;
}

function updatePackageInfo() {
  infoName.textContent = loadedManifest?.name || currentValidationMeta?.widgetName || '-';
  infoVersion.textContent = loadedManifest?.version || currentValidationMeta?.widgetVersion || '-';
  infoId.textContent = loadedManifest?.id || '-';
  infoFileCount.textContent = currentPackageFileCount != null ? String(currentPackageFileCount) : (currentValidationMeta?.fileCount != null ? String(currentValidationMeta.fileCount) : '-');
  infoSource.textContent = currentValidationMeta?.source || '-';
  infoCli.textContent = currentValidationMeta?.cliAvailable == null ? '-' : (currentValidationMeta.cliAvailable ? 'Available' : 'Unavailable');
}

function setValidationState(state) {
  currentValidationState = state;
  currentValidationMeta = state;
  validationBadge.className = 'status-badge';
  validationBadge.classList.add(`status-${state.level}`);
  validationBadge.textContent = state.badge;
  validationSummary.textContent = state.summary;
  validationDetails.textContent = state.details || '';
  if (!state.details) {
    setValidationDetailsExpanded(false);
  }
  updatePackageInfo();
  updateActionButtons();
}

function getValidationLabel(level) {
  if (level === 'pass') return 'Passed';
  if (level === 'warn') return 'Warnings';
  if (level === 'fail') return 'Failed';
  return 'Idle';
}

function getValidationBadgeClass(level) {
  return level === 'pass' || level === 'warn' || level === 'fail' ? `status-${level}` : 'status-neutral';
}

function formatDateTime(timestamp) {
  if (!timestamp) return 'Unknown time';
  return new Date(timestamp).toLocaleString();
}

function resetCurrentWidgetState() {
  currentSessionId = null;
  registeredWidgetSessionId = null;
  revokePreviewObjectUrls();
  loadedManifest = null;
  layouts = [];
  activeLayoutIndex = 0;
  currentLoadedWidgetBytes = null;
  currentLoadedFileName = '';
  currentPackageFileCount = null;
  currentValidationMeta = null;
  currentRuntimeSettings = createEmptyRuntimeSettings();
  currentExternalDomains = [];
  currentArchiveFiles = [];
  currentTextEntries = new Map();
  widgetAssetWarnings = [];
  clearAssetWarnings();
  activeWidgetName.textContent = 'No widget selected';
  setValidationState(createEmptyValidationState());
  updatePackageInfo();
  renderSettingsPanel();
  void updateFrame(true).catch((error) => showPreviewRoutingFailure(error.message || String(error)));
  updateActionButtons();
  switchInspectorTab('preview');
}

function clearAssetWarnings() {
  widgetAssetWarnings = [];
  assetWarning.hidden = true;
  assetWarning.textContent = '';
}

function renderAssetWarnings() {
  if (!widgetAssetWarnings.length) {
    assetWarning.hidden = true;
    assetWarning.textContent = '';
    return;
  }

  const uniquePaths = [...new Set(widgetAssetWarnings.map((item) => item.path).filter(Boolean))];
  const suffix = uniquePaths.length ? ` Missing: ${uniquePaths.join(', ')}` : '';
  assetWarning.hidden = false;
  assetWarning.textContent = `Some packaged assets could not be resolved:${suffix}`;
}

function sanitizeDimension(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getViewportOption(key) {
  return VIEWPORT_OPTIONS.find((option) => option.key === key) || null;
}

function getViewportSize() {
  return VIEWPORTS[viewportSelect.value] || VIEWPORTS[DEFAULT_VIEWPORT_KEY];
}

function getViewportLabel() {
  const viewport = getViewportOption(viewportSelect.value) || getViewportOption(DEFAULT_VIEWPORT_KEY);
  return `${viewport.label} ${viewport.width}x${viewport.height}`;
}

function getScale(size) {
  const styles = window.getComputedStyle(frameCanvas);
  const horizontalPadding = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
  const verticalPadding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
  const availableWidth = Math.max(320, frameCanvas.clientWidth - horizontalPadding);
  const availableHeight = Math.max(220, frameCanvas.clientHeight - verticalPadding);
  return Math.min(1, availableWidth / size.width, availableHeight / size.height);
}

function getContentType(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function isSafeArchivePath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath) return false;

  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return false;
  }

  const normalized = decoded.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;
  if (/^[A-Za-z]:\//.test(normalized)) return false;

  const lower = normalized.toLowerCase();
  if (lower.includes('%2e') || lower.includes('%2f') || lower.includes('%5c')) return false;

  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return false;
  if (parts.some((part) => part === '..' || part === '.')) return false;

  return true;
}

function normalizePath(filePath) {
  if (!isSafeArchivePath(filePath)) return null;
  return decodeURIComponent(filePath).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function splitUrlParts(rawUrl) {
  const value = String(rawUrl || '').trim();
  const match = value.match(/^([^?#]*)([?#][\s\S]*)?$/);
  return {
    path: match?.[1] || value,
    suffix: match?.[2] || ''
  };
}

function isPackageLocalUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value || value.startsWith('#') || value.startsWith('//')) return false;
  if (/^(?:[a-z][a-z0-9+.-]*:)/i.test(value)) return false;
  return true;
}

function resolvePackageUrl(rawUrl, baseDir = '') {
  if (!isPackageLocalUrl(rawUrl)) return null;
  const { path, suffix } = splitUrlParts(rawUrl);
  const resolved = resolvePath(baseDir, path);
  return resolved ? { path: resolved, suffix } : null;
}

function dirname(filePath) {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '' : filePath.slice(0, idx);
}

function resolvePath(baseDir, target) {
  const candidate = `${baseDir}/${target}`.replace(/\\/g, '/');
  const parts = candidate.split('/');
  const stack = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!stack.length) return null;
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  const joined = stack.join('/');
  return normalizePath(joined);
}

function inferLayouts(manifest) {
  const result = [];
  const candidates = Array.isArray(manifest.layouts)
    ? manifest.layouts
    : Array.isArray(manifest.layout)
      ? manifest.layout
      : [];

  for (const item of candidates) {
    const entry = item?.entry || item?.path || item?.file || item?.html || item?.index || item?.src;
    if (!entry) continue;
    const safePath = normalizePath(String(entry));
    if (!safePath) continue;

    result.push({
      id: String(item?.id || item?.name || result.length + 1),
      label: String(item?.name || item?.label || `Layout ${result.length + 1}`),
      path: safePath,
      width: Number(item?.width) || null,
      height: Number(item?.height) || null
    });
  }

  if (!result.length) {
    result.push({ id: 'default', label: 'Default', path: 'index.html', width: null, height: null });
  }

  return result;
}

function getCurrentLayoutId() {
  return layouts[activeLayoutIndex]?.id || null;
}

function reloadForServiceWorkerControl() {
  if (sessionStorage.getItem(SERVICE_WORKER_RELOAD_KEY) !== '1') {
    sessionStorage.setItem(SERVICE_WORKER_RELOAD_KEY, '1');
    window.location.reload();
    return true;
  }
  return false;
}

async function ensureServiceWorkerReady() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('This browser does not support Service Workers.');
  }

  if (!serviceWorkerRegistrationPromise) {
    serviceWorkerRegistrationPromise = navigator.serviceWorker.register('./sw.js').then((registration) => {
      logPreviewTelemetry('SW registered');
      return registration;
    });
  }

  const registration = await serviceWorkerRegistrationPromise;
  const readyRegistration = await navigator.serviceWorker.ready;
  logPreviewTelemetry('SW ready');
  const activeWorker = readyRegistration.active || registration.active;

  if (!activeWorker) {
    throw new Error('Service Worker did not activate. Refresh and try again.');
  }

  if (!navigator.serviceWorker.controller) {
    logPreviewTelemetry('SW controller missing, reloading once');
    if (reloadForServiceWorkerControl()) {
      return new Promise(() => {});
    }
    throw new Error('Preview service worker is active but not controlling this page yet. Refresh and try again.');
  }

  sessionStorage.removeItem(SERVICE_WORKER_RELOAD_KEY);
  logPreviewTelemetry('SW controller present');

  return readyRegistration;
}

function postToServiceWorker(message, registration) {
  return new Promise((resolve, reject) => {
    let settled = false;
    function cleanup() {
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('message', onMessage);
    }

    function finish(error) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    }

    const timeout = window.setTimeout(() => {
      finish(new Error('Timed out while registering widget assets with the preview service worker.'));
    }, 5000);

    function onMessage(event) {
      const data = event.data || {};
      if (data.type !== 'REGISTERED_WIDGET') return;

      if (data.sessionId !== message.sessionId) {
        finish(new Error('Service Worker registered a different widget session than the preview requested.'));
        return;
      }

      registeredWidgetSessionId = data.sessionId;
      logPreviewTelemetry('REGISTERED_WIDGET received', { sessionId: data.sessionId });
      finish();
    }

    navigator.serviceWorker.addEventListener('message', onMessage);
    const target = navigator.serviceWorker.controller || registration?.active || navigator.serviceWorker.ready.then((reg) => reg.active);

    Promise.resolve(target).then((worker) => {
      if (!worker) throw new Error('No active Service Worker found.');
      logPreviewTelemetry('REGISTER_WIDGET sent', {
        sessionId: message.sessionId,
        fileCount: message.files.length,
        layoutPath: getActiveLayoutPath()
      });
      worker.postMessage(message);
    }).catch((err) => {
      finish(err);
    });
  });
}

function looksLikeBuilderAppShell(text) {
  const sample = String(text || '').slice(0, 4096).toLowerCase();
  return BUILDER_APP_SHELL_MARKERS.some((marker) => sample.includes(marker));
}

async function verifyLayoutUrl(layoutUrl, layoutPath) {
  const response = await fetch(layoutUrl, { cache: 'no-store' });
  if (response.status === 404) {
    throw new Error('Widget files were not registered with the preview service worker. Refresh and try again.');
  }
  if (!response.ok) {
    throw new Error(`Preview service worker returned HTTP ${response.status} for ${layoutPath || 'widget layout'}.`);
  }

  const sample = await response.text();
  if (looksLikeBuilderAppShell(sample)) {
    logPreviewTelemetry('layout verification failed', layoutUrl);
    throw new Error(PREVIEW_ROUTING_FAILURE_MESSAGE);
  }

  logPreviewTelemetry('layout verification passed', layoutUrl);
}

async function registerWidgetSessionOnServer(sessionId, files) {
  const response = await fetch('/api/register-widget', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, files })
  });

  if (!response.ok) {
    throw new Error(`Preview server returned HTTP ${response.status} while registering widget assets.`);
  }

  const payload = await response.json();
  if (!payload?.ok) {
    throw new Error(payload?.error || 'Preview server failed to register widget assets.');
  }
}

function isLocalDevServerHost() {
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

function createValidationStateFromResult(result) {
  const lines = [];
  lines.push(`Source: ${result.source}`);
  lines.push(`CLI available: ${result.cliAvailable ? 'yes' : 'no'}`);
  if (result.summary?.widgetName || result.summary?.widgetVersion) {
    lines.push(`Widget: ${result.summary.widgetName || 'unknown'} ${result.summary.widgetVersion || ''}`.trim());
  }
  lines.push(`Files: ${result.summary?.fileCount ?? 'n/a'}`);

  if (Array.isArray(result.errors) && result.errors.length) {
    lines.push('');
    lines.push('Errors:');
    result.errors.forEach((error) => lines.push(`- ${error}`));
  }

  if (Array.isArray(result.warnings) && result.warnings.length) {
    lines.push('');
    lines.push('Warnings:');
    result.warnings.forEach((warning) => lines.push(`- ${warning}`));
  }

  if (result.cli && (result.cli.stdout || result.cli.stderr)) {
    lines.push('');
    lines.push('icuewidget output:');
    if (result.cli.stdout) lines.push(result.cli.stdout);
    if (result.cli.stderr) lines.push(result.cli.stderr);
  }

  const hasErrors = Array.isArray(result.errors) && result.errors.length > 0;
  const hasWarnings = Array.isArray(result.warnings) && result.warnings.length > 0;
  const isHostedLite = result.source === 'hosted-lite';

  if (isHostedLite) {
    return {
      level: 'warn',
      badge: 'Limited',
      summary: 'Hosted validation limited.',
      details: lines.join('\n'),
      source: result.source,
      cliAvailable: Boolean(result.cliAvailable),
      fileCount: result.summary?.fileCount ?? null,
      widgetName: result.summary?.widgetName || null,
      widgetVersion: result.summary?.widgetVersion || null
    };
  }

  if (!hasErrors && !hasWarnings) {
    return {
      level: 'pass',
      badge: 'Passed',
      summary: 'Validation passed.',
      details: lines.join('\n'),
      source: result.source,
      cliAvailable: Boolean(result.cliAvailable),
      fileCount: result.summary?.fileCount ?? null,
      widgetName: result.summary?.widgetName || null,
      widgetVersion: result.summary?.widgetVersion || null
    };
  }

  if (!hasErrors) {
    return {
      level: 'warn',
      badge: 'Warnings',
      summary: 'Validation passed with warnings.',
      details: lines.join('\n'),
      source: result.source,
      cliAvailable: Boolean(result.cliAvailable),
      fileCount: result.summary?.fileCount ?? null,
      widgetName: result.summary?.widgetName || null,
      widgetVersion: result.summary?.widgetVersion || null
    };
  }

  return {
    level: 'fail',
    badge: 'Failed',
    summary: 'Validation failed.',
    details: lines.join('\n'),
    source: result.source,
    cliAvailable: Boolean(result.cliAvailable),
    fileCount: result.summary?.fileCount ?? null,
    widgetName: result.summary?.widgetName || null,
    widgetVersion: result.summary?.widgetVersion || null
  };
}

async function toBase64FromArrayBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      const split = value.split(',', 2);
      if (split.length !== 2 || !split[1]) {
        reject(new Error('Failed to encode widget payload.'));
        return;
      }
      resolve(split[1]);
    };
    reader.onerror = () => reject(new Error('Failed to read widget payload.'));
    reader.readAsDataURL(new Blob([buffer]));
  });
}

async function runAutoValidation(fileName, buffer) {
  const base64 = await toBase64FromArrayBuffer(buffer);

  const response = await fetch('/api/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, base64 })
  });

  if (!response.ok) {
    if ([404, 405, 501].includes(response.status)) {
      return {
        level: 'warn',
        badge: 'Limited',
        summary: 'Hosted validation limited.',
        details: 'Full validation is available in the local Node builder.',
        source: 'hosted-lite',
        cliAvailable: false,
        fileCount: null,
        widgetName: null,
        widgetVersion: null
      };
    }

    return {
      level: 'fail',
      badge: 'Failed',
      summary: 'Validation failed to run.',
      details: `HTTP ${response.status}`,
      source: null,
      cliAvailable: null,
      fileCount: null,
      widgetName: null,
      widgetVersion: null
    };
  }

  const result = await response.json();
  if (result.error) {
    if (result.source === 'hosted-lite') {
      return {
        level: 'warn',
        badge: 'Limited',
        summary: 'Hosted validation limited.',
        details: 'Full validation is available in the local Node builder.',
        source: 'hosted-lite',
        cliAvailable: false,
        fileCount: null,
        widgetName: null,
        widgetVersion: null
      };
    }

    return {
      level: 'fail',
      badge: 'Failed',
      summary: 'Validation failed to run.',
      details: result.error,
      source: null,
      cliAvailable: null,
      fileCount: null,
      widgetName: null,
      widgetVersion: null
    };
  }

  return createValidationStateFromResult(result);
}

function getLayoutUrl() {
  const target = getCurrentLayoutTarget();
  if (!target) return 'about:blank';
  const baseUrl = `/__widget__/${target.sessionId}/${target.layoutPath}`;
  return previewReloadNonce ? `${baseUrl}?reload=${previewReloadNonce}` : baseUrl;
}

function getActiveLayoutPath() {
  return layouts[activeLayoutIndex]?.path || '';
}

function getCurrentLayoutTarget() {
  const layoutPath = getActiveLayoutPath();
  if (!currentSessionId || !layoutPath) return null;
  const baseUrl = `/__widget__/${currentSessionId}/${layoutPath}`;
  return {
    sessionId: currentSessionId,
    layoutPath,
    layoutUrl: previewReloadNonce ? `${baseUrl}?reload=${previewReloadNonce}` : baseUrl
  };
}

function revokePreviewObjectUrls() {
  const revokedCount = revokeObjectUrlList(currentPreviewObjectUrls);
  currentPreviewObjectUrls = [];
  if (revokedCount) {
    logPreviewTelemetry('blob URLs revoked', { count: revokedCount });
  }
}

function revokeObjectUrlList(urls) {
  let revokedCount = 0;
  for (const url of urls || []) {
    URL.revokeObjectURL(url);
    revokedCount += 1;
  }
  return revokedCount;
}

function trackPreviewObjectUrl(url, objectUrls = currentPreviewObjectUrls) {
  objectUrls.push(url);
  return url;
}

function createPreviewObjectUrl(parts, contentType, objectUrls = currentPreviewObjectUrls) {
  return trackPreviewObjectUrl(URL.createObjectURL(new Blob(parts, { type: contentType || 'application/octet-stream' })), objectUrls);
}

function createAssetRewriteDiagnostics() {
  return {
    htmlRewriteCount: 0,
    cssRewriteCount: 0,
    inlinedStylesheetCount: 0,
    unresolved: []
  };
}

function recordUnresolvedAsset(diagnostics, kind, rawUrl, resolvedPath, ownerPath) {
  if (!diagnostics) return;
  diagnostics.unresolved.push({
    kind,
    url: String(rawUrl || ''),
    path: resolvedPath || '',
    owner: ownerPath || ''
  });
}

function rewriteCssUrls(cssText, cssPath, assetUrls, diagnostics = null) {
  const baseDir = dirname(cssPath);
  return String(cssText || '').replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, rawUrl) => {
    const resolved = resolvePackageUrl(rawUrl, baseDir);
    if (!resolved) return match;
    const assetUrl = assetUrls.get(resolved.path);
    if (!assetUrl) {
      recordUnresolvedAsset(diagnostics, 'css', rawUrl, resolved.path, cssPath);
      return match;
    }
    if (diagnostics) diagnostics.cssRewriteCount += 1;
    return `url(${quote || ''}${assetUrl}${resolved.suffix}${quote || ''})`;
  });
}

function rewriteElementUrlAttribute(element, attribute, baseDir, assetUrls, diagnostics, ownerPath, options = {}) {
  const rawUrl = element.getAttribute(attribute);
  const resolved = resolvePackageUrl(rawUrl, baseDir);
  if (!resolved) return false;

  const assetUrl = assetUrls.get(resolved.path);
  if (!assetUrl) {
    recordUnresolvedAsset(diagnostics, options.kind || 'html', rawUrl, resolved.path, ownerPath);
    if (options.blockUnresolved) {
      element.removeAttribute(attribute);
      element.setAttribute('data-xeneon-blocked-src', String(rawUrl || ''));
    }
    return false;
  }

  element.setAttribute(attribute, `${assetUrl}${resolved.suffix}`);
  if (diagnostics) diagnostics.htmlRewriteCount += 1;
  return true;
}

function rewriteHtmlAssetUrls(htmlText, layoutPath, assetUrls, diagnostics = null, cssTextByPath = new Map()) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const baseDir = dirname(layoutPath);
  const urlAttributes = [
    ['script[src]', 'src'],
    ['img[src]', 'src'],
    ['source[src]', 'src'],
    ['video[src]', 'src'],
    ['audio[src]', 'src'],
    ['image[href]', 'href'],
    ['track[src]', 'src'],
    ['embed[src]', 'src'],
    ['object[data]', 'data']
  ];

  for (const element of doc.querySelectorAll('link[href]')) {
    const resolved = resolvePackageUrl(element.getAttribute('href'), baseDir);
    const rel = String(element.getAttribute('rel') || '').toLowerCase().split(/\s+/);
    if (!resolved) continue;

    if (rel.includes('stylesheet') && cssTextByPath.has(resolved.path)) {
      const style = doc.createElement('style');
      style.setAttribute('data-xeneon-inline-href', element.getAttribute('href') || resolved.path);
      style.textContent = cssTextByPath.get(resolved.path) || '';
      element.replaceWith(style);
      if (diagnostics) {
        diagnostics.htmlRewriteCount += 1;
        diagnostics.inlinedStylesheetCount += 1;
      }
      continue;
    }

    rewriteElementUrlAttribute(element, 'href', baseDir, assetUrls, diagnostics, layoutPath);
  }

  for (const [selector, attribute] of urlAttributes) {
    for (const element of doc.querySelectorAll(selector)) {
      rewriteElementUrlAttribute(element, attribute, baseDir, assetUrls, diagnostics, layoutPath);
    }
  }

  for (const element of doc.querySelectorAll('use[href]')) {
    rewriteElementUrlAttribute(element, 'href', baseDir, assetUrls, diagnostics, layoutPath, { kind: 'svg-use' });
  }

  for (const element of doc.querySelectorAll('use[xlink\\:href]')) {
    rewriteElementUrlAttribute(element, 'xlink:href', baseDir, assetUrls, diagnostics, layoutPath, { kind: 'svg-use' });
  }

  for (const element of doc.querySelectorAll('iframe[src]')) {
    rewriteElementUrlAttribute(element, 'src', baseDir, assetUrls, diagnostics, layoutPath, {
      kind: 'iframe',
      blockUnresolved: true
    });
    const src = element.getAttribute('src') || '';
    if (src.startsWith('blob:')) {
      element.setAttribute('sandbox', 'allow-scripts');
    }
  }

  for (const element of doc.querySelectorAll('[srcset]')) {
    const rewritten = String(element.getAttribute('srcset') || '').split(',').map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      const resolved = resolvePackageUrl(parts[0], baseDir);
      if (!resolved) return candidate;
      const assetUrl = assetUrls.get(resolved.path);
      if (!assetUrl) {
        recordUnresolvedAsset(diagnostics, 'srcset', parts[0], resolved.path, layoutPath);
        return candidate;
      }
      if (diagnostics) diagnostics.htmlRewriteCount += 1;
      return [`${assetUrl}${resolved.suffix}`, ...parts.slice(1)].join(' ');
    }).join(', ');
    element.setAttribute('srcset', rewritten);
  }

  for (const element of doc.querySelectorAll('[style]')) {
    element.setAttribute('style', rewriteCssUrls(element.getAttribute('style') || '', layoutPath, assetUrls, diagnostics));
  }

  for (const style of doc.querySelectorAll('style')) {
    style.textContent = rewriteCssUrls(style.textContent || '', layoutPath, assetUrls, diagnostics);
  }

  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

function detectJsStaticAssetReferences(assetUrls) {
  const decoder = new TextDecoder();
  const references = [];
  const stringPattern = /(['"`])((?:\.{1,2}\/|\/)?[A-Za-z0-9._~!$&'()*+,;=:@/-]+\.(?:png|jpe?g|gif|webp|svg|ico|css|json|mp3|wav|ogg|mp4|webm|woff2?|ttf|otf)(?:[?#][^'"`]*)?)\1/gi;

  for (const file of currentArchiveFiles) {
    if (!file.contentType.includes('javascript')) continue;
    const jsText = decoder.decode(file.bytes);
    const baseDir = dirname(file.path);
    let match;
    while ((match = stringPattern.exec(jsText)) && references.length < 10) {
      const resolved = resolvePackageUrl(match[2], baseDir);
      if (resolved && assetUrls.has(resolved.path)) {
        references.push({ owner: file.path, url: match[2], path: resolved.path });
      }
    }
  }

  return references;
}

function buildPreviewSrcdoc(layoutPath) {
  const runtimePayload = getLayoutRuntimePayload();
  const assetUrls = new Map();
  const objectUrls = [];
  const decoder = new TextDecoder();
  const diagnostics = createAssetRewriteDiagnostics();
  const cssFiles = [];
  const cssTextByPath = new Map();

  for (const file of currentArchiveFiles) {
    if (file.contentType.startsWith('text/css')) {
      cssFiles.push(file);
      continue;
    }
    assetUrls.set(file.path, createPreviewObjectUrl([file.bytes], file.contentType, objectUrls));
  }

  for (const file of cssFiles) {
    const cssText = currentTextEntries.get(file.path) || decoder.decode(file.bytes);
    const rewrittenCss = rewriteCssUrls(cssText, file.path, assetUrls, diagnostics);
    cssTextByPath.set(file.path, rewrittenCss);
    assetUrls.set(file.path, createPreviewObjectUrl([rewrittenCss], file.contentType, objectUrls));
  }

  const layoutHtml = currentTextEntries.get(layoutPath);
  if (typeof layoutHtml !== 'string') {
    throw new Error('Widget layout file was not available for sandbox rendering.');
  }

  const injectedHtml = injectPreviewRuntime(layoutHtml, runtimePayload);
  const srcdoc = rewriteHtmlAssetUrls(injectedHtml, layoutPath, assetUrls, diagnostics, cssTextByPath);
  widgetAssetWarnings = diagnostics.unresolved.slice(0, 10);
  renderAssetWarnings();
  logPreviewTelemetry('asset map built', { count: assetUrls.size });
  logPreviewTelemetry('HTML asset rewrites', { count: diagnostics.htmlRewriteCount });
  logPreviewTelemetry('CSS asset rewrites', { count: diagnostics.cssRewriteCount });
  logPreviewTelemetry('inlined package stylesheets', { count: diagnostics.inlinedStylesheetCount });
  if (diagnostics.unresolved.length) {
    logPreviewTelemetry('unresolved local asset references', diagnostics.unresolved.slice(0, 10));
  }
  const jsStaticReferences = detectJsStaticAssetReferences(assetUrls);
  if (jsStaticReferences.length) {
    logPreviewTelemetry('JS static asset path rewriting is not performed', jsStaticReferences);
  }
  return { srcdoc, objectUrls };
}

function setWidgetFrameSource(layoutUrl, srcdoc = '') {
  widgetFrame.src = srcdoc ? 'about:blank' : layoutUrl;
  widgetFrame.srcdoc = srcdoc;
  widgetFrame.dataset.src = layoutUrl;
}

function clearWidgetFrameToBlank() {
  revokePreviewObjectUrls();
  setWidgetFrameSource('about:blank');
}

function showPreviewRoutingFailure(message) {
  clearWidgetFrameToBlank();
  setStatusMessage(message);
  setLibraryMessage(message, 'fail');
}

async function updateFrame(forceReload = false) {
  const size = getViewportSize();
  const scale = getScale(size);
  const updateId = ++frameUpdateSequence;

  frameDimensions.textContent = `${size.width} x ${size.height}`;
  activeViewportLabel.textContent = getViewportLabel();

  frameStage.style.width = `${Math.max(1, Math.round(size.width * scale))}px`;
  frameStage.style.height = `${Math.max(1, Math.round(size.height * scale))}px`;
  frameScaler.style.transform = `scale(${scale})`;

  widgetFrame.width = String(size.width);
  widgetFrame.height = String(size.height);
  widgetFrame.style.width = `${size.width}px`;
  widgetFrame.style.height = `${size.height}px`;

  const target = getCurrentLayoutTarget();
  const nextPath = target?.layoutUrl || 'about:blank';
  const shouldShowEmpty = !target;
  emptyState.hidden = !shouldShowEmpty;
  frameStage.hidden = shouldShowEmpty;

  if (shouldShowEmpty) {
    clearWidgetFrameToBlank();
    updateActionButtons();
    return;
  }

  if (forceReload || widgetFrame.dataset.src !== nextPath) {
    logPreviewTelemetry('render requested', {
      currentSessionId,
      registeredWidgetSessionId,
      layoutUrl: nextPath
    });
    await ensureServiceWorkerReady();
    if (registeredWidgetSessionId !== currentSessionId) {
      throw new Error('Widget assets are not registered with the preview service worker yet. Refresh and try again.');
    }
    await verifyLayoutUrl(nextPath, target.layoutPath);
    if (updateId !== frameUpdateSequence) {
      return;
    }
    const previewDocument = buildPreviewSrcdoc(target.layoutPath);
    if (updateId !== frameUpdateSequence) {
      const revokedCount = revokeObjectUrlList(previewDocument.objectUrls);
      if (revokedCount) logPreviewTelemetry('blob URLs revoked', { count: revokedCount });
      return;
    }
    revokePreviewObjectUrls();
    currentPreviewObjectUrls = previewDocument.objectUrls;
    const srcdoc = previewDocument.srcdoc;
    setWidgetFrameSource(nextPath, srcdoc);
    logPreviewTelemetry('iframe src set', { layoutUrl: nextPath });
  }

  updateActionButtons();
}

function createWidgetRecordPayload({ localId, fileName, bytes, manifest, validationState, fileCount, uploadedAt, settings, runtimeSettings, hash = null }) {
  return {
    localId,
    fileName,
    uploadedAt,
    bytes,
    byteLength: bytes.byteLength,
    hash,
    manifestName: manifest?.name || null,
    manifestVersion: manifest?.version || null,
    manifestId: manifest?.id || null,
    validation: {
      level: validationState.level,
      badge: validationState.badge,
      summary: validationState.summary,
      details: validationState.details,
      source: validationState.source,
      cliAvailable: validationState.cliAvailable,
      fileCount: validationState.fileCount ?? fileCount ?? null,
      widgetName: validationState.widgetName || manifest?.name || null,
      widgetVersion: validationState.widgetVersion || manifest?.version || null
    },
    fileCount: fileCount ?? null,
    settings,
    runtimeSettings
  };
}

function getCurrentSettingsSnapshot() {
  return {
    viewportKey: viewportSelect.value,
    layoutId: getCurrentLayoutId()
  };
}

function openLibraryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_WIDGET_STORE)) {
        db.createObjectStore(DB_WIDGET_STORE, { keyPath: 'localId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function runDbOperation(mode, action) {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_WIDGET_STORE, mode);
    const store = transaction.objectStore(DB_WIDGET_STORE);
    let request;

    try {
      request = action(store);
    } catch (error) {
      reject(error);
      db.close();
      return;
    }

    let result;
    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => {
        reject(request.error || new Error('IndexedDB request failed.'));
      };
    }

    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('IndexedDB transaction failed.'));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error('IndexedDB transaction aborted.'));
    };
  });
}

function cloneRecord(record) {
  return {
    ...record,
    bytes: record.bytes ? record.bytes.slice(0) : record.bytes,
    validation: record.validation ? { ...record.validation } : null,
    settings: record.settings ? { ...record.settings } : null,
    runtimeSettings: record.runtimeSettings ? deepClone(record.runtimeSettings) : null
  };
}

async function getAllWidgetRecords() {
  const records = await runDbOperation('readonly', (store) => store.getAll());
  return (records || []).map(cloneRecord).sort((a, b) => b.uploadedAt - a.uploadedAt);
}

async function saveWidgetRecord(record) {
  await runDbOperation('readwrite', (store) => store.put(record));
}

async function deleteWidgetRecord(localId) {
  await runDbOperation('readwrite', (store) => store.delete(localId));
}

async function clearWidgetRecords() {
  await runDbOperation('readwrite', (store) => store.clear());
}

function findRecordById(localId) {
  return libraryRecords.find((record) => record.localId === localId) || null;
}

function renderLibrary() {
  widgetLibrary.innerHTML = '';
  const uniqueRecords = dedupeRenderableRecords(libraryRecords);
  libraryCount.textContent = String(uniqueRecords.length);

  if (!uniqueRecords.length) {
    const empty = document.createElement('div');
    empty.className = 'library-empty';
    empty.textContent = 'No saved widgets yet. Upload a package to build a reusable local preview library.';
    widgetLibrary.appendChild(empty);
    return;
  }

  uniqueRecords.forEach((record) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'widget-row';
    if (record.localId === currentWidgetRecordId) button.classList.add('active');

    const displayName = record.manifestName || record.validation?.widgetName || record.fileName;
    const version = record.manifestVersion || record.validation?.widgetVersion || '-';
    const validationLabel = record.validation?.badge || getValidationLabel(record.validation?.level);
    const fileCount = record.fileCount ?? record.validation?.fileCount ?? '-';
    button.innerHTML = [
      '<span class="widget-row-top">',
      `<span class="widget-row-label">${escapeHtml(displayName)}</span>`,
      `<span class="status-badge ${escapeHtml(getValidationBadgeClass(record.validation?.level))}">${escapeHtml(validationLabel || 'Idle')}</span>`,
      '</span>',
      `<span class="widget-row-meta">Version ${escapeHtml(version)} · ${escapeHtml(String(fileCount))} files</span>`,
      `<span class="widget-row-file">${escapeHtml(record.fileName)}</span>`
    ].join('');

    button.addEventListener('click', () => {
      loadWidgetFromLibraryRecord(record).catch((error) => {
        setStatusMessage(`Failed to load widget: ${error.message || error}`);
        setLibraryMessage(error.message || String(error), 'fail');
      });
    });

    widgetLibrary.appendChild(button);
  });
}

function renderSettingsPanel() {
  settingsList.innerHTML = '';
  const definitions = getCurrentLayoutDefinitions();
  proxyEnabledInput.checked = Boolean(currentRuntimeSettings.proxyEnabled);
  externalWarning.hidden = !currentExternalResourceWarning;
  externalWarning.textContent = currentExternalResourceWarning;

  if (!layouts.length) {
    settingsSummary.textContent = 'Load a widget layout with x-icue-property metadata to emulate widget settings locally.';
    const empty = document.createElement('p');
    empty.className = 'settings-empty';
    empty.textContent = 'No widget is active yet.';
    settingsList.appendChild(empty);
    proxyWarning.textContent = 'Network preview is off. External network access is blocked in preview.';
    updateActionButtons();
    return;
  }

  if (!definitions.length) {
    settingsSummary.textContent = 'The active layout does not declare any x-icue-property settings.';
    const empty = document.createElement('p');
    empty.className = 'settings-empty';
    empty.textContent = 'Switch layouts or load a widget that exposes widget settings metadata.';
    settingsList.appendChild(empty);
  } else {
    settingsSummary.textContent = `Parsed ${definitions.length} widget setting${definitions.length === 1 ? '' : 's'} from the active layout.`;
    for (const definition of definitions) {
      settingsList.appendChild(renderSettingControl(definition));
    }
  }

  proxyWarning.textContent = currentRuntimeSettings.proxyEnabled
    ? 'Network preview is on. External GET requests are routed through /api/proxy. Reload preview after enabling network preview.'
    : 'Network preview is off. External network access is blocked in preview.';

  updateActionButtons();
}

function renderSettingControl(definition) {
  const card = document.createElement('div');
  card.className = 'setting-card';

  const header = document.createElement('div');
  header.className = 'setting-header';

  const textWrap = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = definition.label;
  const debug = document.createElement('small');
  debug.className = 'setting-debug';
  debug.textContent = `${definition.type} · ${definition.name}`;
  textWrap.append(title, debug);

  header.appendChild(textWrap);
  card.appendChild(header);

  const currentValue = normalizeSettingValue(definition, currentRuntimeSettings.values?.[definition.name]);
  let control = null;

  if (definition.type === 'textfield') {
    control = document.createElement('input');
    control.className = 'field-control';
    control.type = 'text';
    control.value = String(currentValue ?? '');
    control.addEventListener('input', () => {
      handleRuntimeSettingChange(definition.name, control.value);
    });
  } else if (definition.type === 'color') {
    const colorValue = normalizeColorValue(currentValue) || '#ffffff';
    control = document.createElement('input');
    control.className = 'field-control';
    control.type = 'color';
    control.value = colorValue;
    control.addEventListener('input', () => {
      handleRuntimeSettingChange(definition.name, control.value);
    });
  } else if (definition.type === 'slider') {
    const row = document.createElement('div');
    row.className = 'setting-inline-row';
    control = document.createElement('input');
    control.className = 'field-control';
    control.type = 'range';
    control.min = String(definition.min ?? 0);
    control.max = String(definition.max ?? 100);
    control.step = String(definition.step ?? 1);
    control.value = String(currentValue ?? definition.min ?? 0);
    const valueLabel = document.createElement('span');
    valueLabel.className = 'setting-range-value';
    valueLabel.textContent = `${control.value}${definition.unitLabel ? ` ${definition.unitLabel}` : ''}`;
    control.addEventListener('input', () => {
      valueLabel.textContent = `${control.value}${definition.unitLabel ? ` ${definition.unitLabel}` : ''}`;
      handleRuntimeSettingChange(definition.name, Number.parseFloat(control.value));
    });
    row.append(control, valueLabel);
    card.appendChild(row);
    return card;
  } else if (definition.type === 'checkbox') {
    const row = document.createElement('label');
    row.className = 'toggle-row';
    const rowText = document.createElement('span');
    rowText.innerHTML = '<strong>Enabled</strong><small>Toggle this widget setting on or off.</small>';
    control = document.createElement('input');
    control.type = 'checkbox';
    control.checked = Boolean(currentValue);
    control.addEventListener('change', () => {
      handleRuntimeSettingChange(definition.name, control.checked);
    });
    row.append(rowText, control);
    card.appendChild(row);
    return card;
  } else if (definition.type === 'combobox') {
    control = document.createElement('select');
    control.className = 'field-control';
    for (const option of definition.options) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      control.appendChild(element);
    }
    if (!definition.options.some((option) => option.value === currentValue)) {
      const fallbackOption = document.createElement('option');
      fallbackOption.value = String(currentValue ?? '');
      fallbackOption.textContent = String(currentValue ?? '(empty)');
      control.appendChild(fallbackOption);
    }
    control.value = String(currentValue ?? '');
    control.addEventListener('change', () => {
      handleRuntimeSettingChange(definition.name, control.value);
    });
  } else if (definition.type === 'tab-buttons') {
    const row = document.createElement('div');
    row.className = 'setting-tab-buttons';
    for (const option of definition.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'setting-tab-button';
      if (option.value === currentValue) button.classList.add('is-active');
      button.textContent = option.label;
      button.addEventListener('click', () => {
        handleRuntimeSettingChange(definition.name, option.value);
      });
      row.appendChild(button);
    }
    card.appendChild(row);
    return card;
  } else if (definition.type === 'media-selector') {
    const empty = document.createElement('p');
    empty.className = 'settings-empty';
    empty.textContent = definition.mediaFilters
      ? `Media selector is not supported yet in local preview. Filters: ${definition.mediaFilters}.`
      : 'Media selector is not supported yet in local preview.';
    card.appendChild(empty);
    return card;
  } else {
    const empty = document.createElement('p');
    empty.className = 'settings-empty';
    empty.textContent = `Unsupported setting type "${definition.type}". Current value: ${String(currentValue ?? '') || '(empty)'}`;
    card.appendChild(empty);
    return card;
  }

  card.appendChild(control);
  const hintText = getSettingHintText(definition, currentValue);
  if (hintText) {
    const hint = document.createElement('p');
    hint.className = 'settings-empty';
    hint.innerHTML = hintText;
    card.appendChild(hint);
  }
  return card;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function extractExternalDomains(text, domainSet) {
  const rawUrls = text.match(/https?:\/\/[^\s'"<>()[\],]+/gi) || [];
  for (const raw of rawUrls) {
    try {
      const parsed = new URL(raw);
      domainSet.add(parsed.hostname);
    } catch {
      // ignore unparseable fragments
    }
  }
}

function buildExternalWarningText(domains) {
  const shown = domains.slice(0, 5).join(', ');
  const extra = domains.length > 5 ? ` and ${domains.length - 5} more` : '';
  return `This widget tries to load external resources from: ${shown}${extra}. External network access is blocked by default in local preview.`;
}

function applyStoredSettings(settings) {
  const viewportKey = settings?.viewportKey || DEFAULT_VIEWPORT_KEY;
  viewportSelect.value = viewportKey;
}

function applyStoredRuntimeSettings(runtimeSettings) {
  currentRuntimeSettings = {
    definitionsByLayout: deepClone(runtimeSettings?.definitionsByLayout || {}),
    values: deepClone(runtimeSettings?.values || {}),
    proxyEnabled: Boolean(runtimeSettings?.proxyEnabled)
  };
  ensureWidgetSettingDefaults();
  renderSettingsPanel();
}

function selectStoredLayout(layoutId) {
  if (!layoutId) {
    activeLayoutIndex = 0;
    return;
  }
  const nextIndex = layouts.findIndex((layout) => layout.id === layoutId);
  activeLayoutIndex = nextIndex >= 0 ? nextIndex : 0;
}

function fallbackRecordFingerprint(record) {
  return [
    record.fileName || '',
    String(record.byteLength || ''),
    record.manifestId || '',
    record.manifestVersion || ''
  ].join('::');
}

function dedupeRenderableRecords(records) {
  const seenLocalIds = new Set();
  const seenHashes = new Set();
  const seenFallbacks = new Set();
  const unique = [];

  for (const record of records || []) {
    if (!record || seenLocalIds.has(record.localId)) continue;
    seenLocalIds.add(record.localId);

    if (record.hash) {
      if (seenHashes.has(record.hash)) continue;
      seenHashes.add(record.hash);
    } else {
      const fallback = fallbackRecordFingerprint(record);
      if (seenFallbacks.has(fallback)) continue;
      seenFallbacks.add(fallback);
    }
    unique.push(record);
  }

  return unique;
}

async function persistCurrentWidgetSettings() {
  if (!currentWidgetRecordId) return;
  const record = findRecordById(currentWidgetRecordId);
  if (!record) return;

  const updated = {
    ...record,
    settings: getCurrentSettingsSnapshot(),
    runtimeSettings: getCurrentWidgetRuntimeSnapshot()
  };

  try {
    await saveWidgetRecord(updated);
    libraryRecords = libraryRecords.map((item) => item.localId === updated.localId ? cloneRecord(updated) : item);
  } catch (error) {
    setLibraryMessage(`Could not save widget settings: ${error.message || error}`, 'warn');
  }
}

async function handleRuntimeSettingChange(name, value) {
  const definition = getCurrentLayoutDefinitions().find((item) => item.name === name);
  const nextValue = definition ? normalizeSettingValue(definition, value) : value;
  currentRuntimeSettings = {
    ...currentRuntimeSettings,
    values: {
      ...currentRuntimeSettings.values,
      [name]: nextValue
    }
  };
  renderSettingsPanel();
  await persistCurrentWidgetSettings();
  sendSettingsToPreviewFrame();
}

async function refreshWidgetSessionHtml() {
  if (!currentSessionId || !currentArchiveFiles.length) return;
  registeredWidgetSessionId = null;
  const runtimePayload = getLayoutRuntimePayload();
  const files = [];
  for (const file of currentArchiveFiles) {
    let outgoingBytes = file.bytes;
    if (file.contentType.startsWith('text/html')) {
      const htmlText = currentTextEntries.get(file.path) || '';
      const injected = injectPreviewRuntime(htmlText, runtimePayload);
      outgoingBytes = new TextEncoder().encode(injected).buffer;
    }
    const base64 = await toBase64FromArrayBuffer(outgoingBytes);
    files.push({ path: file.path, base64, contentType: file.contentType });
  }
  assertActiveLayoutRegistered(files);
  if (isLocalDevServerHost()) {
    await registerWidgetSessionOnServer(currentSessionId, files);
  }
  const registration = await ensureServiceWorkerReady();
  await postToServiceWorker({ type: 'REGISTER_WIDGET', sessionId: currentSessionId, files }, registration);
}

async function handleProxyToggleChange() {
  currentRuntimeSettings = {
    ...currentRuntimeSettings,
    proxyEnabled: proxyEnabledInput.checked
  };
  renderSettingsPanel();
  await persistCurrentWidgetSettings();
  if (currentSessionId && currentArchiveFiles.length) {
    try {
      await refreshWidgetSessionHtml();
      previewReloadNonce = Date.now();
      await updateFrame(true);
    } catch (error) {
      showPreviewRoutingFailure(error.message || String(error));
      sendSettingsToPreviewFrame();
    }
  } else {
    sendSettingsToPreviewFrame();
  }
}

async function resetRuntimeSettingsToDefaults() {
  const nextValues = {};
  for (const definitions of Object.values(currentRuntimeSettings.definitionsByLayout || {})) {
    for (const definition of definitions) {
      nextValues[definition.name] = normalizeSettingValue(definition, definition.defaultValue);
    }
  }
  currentRuntimeSettings = {
    ...currentRuntimeSettings,
    values: nextValues
  };
  renderSettingsPanel();
  await persistCurrentWidgetSettings();
  sendSettingsToPreviewFrame();
}

function sendSettingsToPreviewFrame() {
  if (!currentSessionId || !widgetFrame.contentWindow) return;
  widgetFrame.contentWindow.postMessage({
    type: 'ICUE_PREVIEW_SETTINGS',
    payload: getLayoutRuntimePayload()
  }, '*');
}

async function handleProxyRequestMessage(data, sourceWindow) {
  if (!currentRuntimeSettings.proxyEnabled) {
    sourceWindow.postMessage({
      type: 'ICUE_PREVIEW_PROXY_RESPONSE',
      requestId: data.requestId,
      ok: false,
      error: 'Local proxy is disabled.'
    }, '*');
    return;
  }

  try {
    const response = await fetch(`/api/proxy?url=${encodeURIComponent(String(data.url || ''))}`, {
      headers: {
        'X-Widget-Proxy-Enabled': '1',
        'X-Xeneon-Network-Preview': '1',
        Accept: typeof data.accept === 'string' ? data.accept : ''
      }
    });
    const body = await response.text();
    sourceWindow.postMessage({
      type: 'ICUE_PREVIEW_PROXY_RESPONSE',
      requestId: data.requestId,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: {
        'content-type': response.headers.get('content-type') || 'text/plain; charset=utf-8'
      },
      body,
      error: response.ok ? null : body
    }, '*');
  } catch (error) {
    sourceWindow.postMessage({
      type: 'ICUE_PREVIEW_PROXY_RESPONSE',
      requestId: data.requestId,
      ok: false,
      error: String(error.message || error)
    }, '*');
  }
}

async function guardStorageForWidget(byteLength) {
  if (byteLength > MAX_LIBRARY_WIDGET_BYTES) {
    const maxMb = Math.round((MAX_LIBRARY_WIDGET_BYTES / (1024 * 1024)) * 10) / 10;
    throw createStorageError(`Widget is too large to save locally. The local library limit is ${maxMb} MB per widget.`);
  }

  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.quota === 'number' && typeof estimate.usage === 'number') {
      const headroom = estimate.quota - estimate.usage;
      if (headroom < byteLength + MIN_STORAGE_HEADROOM_BYTES) {
        throw createStorageError('Not enough browser storage is available to save this widget. Delete saved widgets and try again.');
      }
    }
  }
}

function createLocalId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function saveUploadedWidgetToLibrary({ fileName, bytes, manifest, validationState, fileCount }) {
  await guardStorageForWidget(bytes.byteLength);
  const hash = await computeWidgetHash(bytes);
  const duplicate = findDuplicateRecord({
    hash,
    fileName,
    byteLength: bytes.byteLength,
    manifestId: manifest?.id || null,
    manifestVersion: manifest?.version || null
  });

  if (duplicate) {
    const updated = {
      ...duplicate,
      bytes: bytes.slice(0),
      byteLength: bytes.byteLength,
      hash,
      uploadedAt: Date.now(),
      manifestName: manifest?.name || duplicate.manifestName || null,
      manifestVersion: manifest?.version || duplicate.manifestVersion || null,
      manifestId: manifest?.id || duplicate.manifestId || null,
      fileCount: fileCount ?? duplicate.fileCount ?? null,
      validation: {
        level: validationState.level,
        badge: validationState.badge,
        summary: validationState.summary,
        details: validationState.details,
        source: validationState.source,
        cliAvailable: validationState.cliAvailable,
        fileCount: validationState.fileCount ?? fileCount ?? duplicate.fileCount ?? null,
        widgetName: validationState.widgetName || manifest?.name || duplicate.manifestName || null,
        widgetVersion: validationState.widgetVersion || manifest?.version || duplicate.manifestVersion || null
      },
      settings: getCurrentSettingsSnapshot(),
      runtimeSettings: getCurrentWidgetRuntimeSnapshot()
    };
    await saveWidgetRecord(updated);
    libraryRecords = [cloneRecord(updated), ...libraryRecords.filter((record) => record.localId !== updated.localId)];
    currentWidgetRecordId = updated.localId;
    renderLibrary();
    updateActionButtons();
    setTransientLibraryMessage('Widget already in library.', 'warn');
    return;
  }

  const record = createWidgetRecordPayload({
    localId: createLocalId(),
    fileName,
    bytes: bytes.slice(0),
    manifest,
    validationState,
    fileCount,
    uploadedAt: Date.now(),
    settings: getCurrentSettingsSnapshot(),
    runtimeSettings: getCurrentWidgetRuntimeSnapshot(),
    hash
  });

  await saveWidgetRecord(record);
  libraryRecords = [cloneRecord(record), ...libraryRecords];
  currentWidgetRecordId = record.localId;
  renderLibrary();
  updateActionButtons();
}

async function computeWidgetHash(bytes) {
  if (!window.crypto?.subtle || !bytes) return null;
  try {
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    const digestBytes = new Uint8Array(digest);
    return [...digestBytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

function findDuplicateRecord({ hash, fileName, byteLength, manifestId, manifestVersion }) {
  const hashMatch = hash
    ? libraryRecords.find((record) => record.hash && record.hash === hash)
    : null;
  if (hashMatch) return hashMatch;

  return libraryRecords.find((record) => {
    if (record.hash) return false;
    return (record.fileName || '') === (fileName || '')
      && Number(record.byteLength || 0) === Number(byteLength || 0)
      && (record.manifestId || '') === (manifestId || '')
      && (record.manifestVersion || '') === (manifestVersion || '');
  }) || null;
}

async function updateCurrentRecordValidation(validationState) {
  if (!currentWidgetRecordId) return;
  const record = findRecordById(currentWidgetRecordId);
  if (!record) return;

  const updated = {
    ...record,
    manifestName: loadedManifest?.name || record.manifestName,
    manifestVersion: loadedManifest?.version || record.manifestVersion,
    manifestId: loadedManifest?.id || record.manifestId,
    fileCount: currentPackageFileCount ?? record.fileCount,
    validation: {
      level: validationState.level,
      badge: validationState.badge,
      summary: validationState.summary,
      details: validationState.details,
      source: validationState.source,
      cliAvailable: validationState.cliAvailable,
      fileCount: validationState.fileCount ?? currentPackageFileCount ?? record.fileCount ?? null,
      widgetName: validationState.widgetName || loadedManifest?.name || record.manifestName || null,
      widgetVersion: validationState.widgetVersion || loadedManifest?.version || record.manifestVersion || null
    },
    settings: getCurrentSettingsSnapshot(),
    runtimeSettings: getCurrentWidgetRuntimeSnapshot()
  };

  await saveWidgetRecord(updated);
  libraryRecords = libraryRecords.map((item) => item.localId === updated.localId ? cloneRecord(updated) : item);
  renderLibrary();
}

async function loadWidgetArchive({ fileName, bytes, preferredLayoutId, initialSettings }) {
  if (!window.JSZip) throw new Error('JSZip failed to load. Check network access and retry.');

  const zip = await JSZip.loadAsync(bytes.slice(0));
  const archiveFiles = [];
  const rootPathSet = new Set();
  const textEntries = new Map();
  const externalDomainSet = new Set();

  for (const [zipPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;

    const normalizedPath = normalizePath(zipPath);
    if (!normalizedPath) {
      throw new Error(`Unsafe archive path detected: ${zipPath}`);
    }

    const contentType = getContentType(normalizedPath);
    const fileBytes = await entry.async('uint8array');
    archiveFiles.push({
      path: normalizedPath,
      contentType,
      bytes: fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength)
    });
    if (contentType.startsWith('text/html')) {
      const htmlText = await entry.async('string');
      textEntries.set(normalizedPath, htmlText);
      extractExternalDomains(htmlText, externalDomainSet);
    } else if (contentType.includes('javascript') || contentType.includes('json') || contentType.includes('css') || contentType.startsWith('text/')) {
      const text = await entry.async('string');
      extractExternalDomains(text, externalDomainSet);
    }
    rootPathSet.add(normalizedPath);
  }

  currentArchiveFiles = archiveFiles.map((f) => ({ path: f.path, contentType: f.contentType, bytes: f.bytes }));
  currentTextEntries = new Map(textEntries);

  const manifestZipEntry = zip.file('manifest.json');
  if (!manifestZipEntry) {
    throw new Error('manifest.json not found inside widget package.');
  }

  loadedManifest = JSON.parse(await manifestZipEntry.async('string'));
  layouts = inferLayouts(loadedManifest);

  for (const layout of layouts) {
    if (!rootPathSet.has(layout.path)) {
      const fallback = resolvePath(dirname(layout.path), 'index.html');
      if (fallback && rootPathSet.has(fallback)) layout.path = fallback;
    }
  }

  const definitionsByLayout = {};
  for (const layout of layouts) {
    definitionsByLayout[layout.id] = parseWidgetSettingsFromHtml(textEntries.get(layout.path) || '');
  }

  applyStoredRuntimeSettings({
    definitionsByLayout,
    values: deepClone(initialSettings?.runtimeValues || initialSettings?.values || {}),
    proxyEnabled: Boolean(initialSettings?.proxyEnabled)
  });

  currentSessionId = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  registeredWidgetSessionId = null;
  currentLoadedWidgetBytes = bytes.slice(0);
  currentLoadedFileName = fileName;
  currentPackageFileCount = archiveFiles.length;
  previewReloadNonce = 0;
  currentExternalDomains = [...externalDomainSet];
  currentExternalResourceWarning = currentExternalDomains.length
    ? buildExternalWarningText(currentExternalDomains)
    : '';
  clearAssetWarnings();

  applyStoredSettings(initialSettings);
  selectStoredLayout(preferredLayoutId);
  renderSettingsPanel();

  const runtimePayload = getLayoutRuntimePayload();
  const files = [];
  for (const file of archiveFiles) {
    let outgoingBytes = file.bytes;
    if (file.contentType.startsWith('text/html')) {
      const htmlText = textEntries.get(file.path) || '';
      const injected = injectPreviewRuntime(htmlText, runtimePayload);
      outgoingBytes = new TextEncoder().encode(injected).buffer;
    }
    const base64 = await toBase64FromArrayBuffer(outgoingBytes);
    files.push({ path: file.path, base64, contentType: file.contentType });
  }
  assertActiveLayoutRegistered(files);

  if (isLocalDevServerHost()) {
    await registerWidgetSessionOnServer(currentSessionId, files);
  }
  const registration = await ensureServiceWorkerReady();
  await postToServiceWorker({ type: 'REGISTER_WIDGET', sessionId: currentSessionId, files }, registration);

  activeWidgetName.textContent = loadedManifest.name || fileName;
  setStatusMessage('');
  updatePackageInfo();
  updateActionButtons();
  switchInspectorTab('preview');
}

async function revalidateCurrentWidget() {
  if (!currentLoadedWidgetBytes || !currentLoadedFileName) return;
  setValidationState({
    level: 'warn',
    badge: 'Running',
    summary: 'Running validation...',
    details: '',
    source: null,
    cliAvailable: null,
    fileCount: currentPackageFileCount,
    widgetName: loadedManifest?.name || null,
    widgetVersion: loadedManifest?.version || null
  });

  const validationState = await runAutoValidation(currentLoadedFileName, currentLoadedWidgetBytes);
  setValidationState(validationState);
  try {
    await updateCurrentRecordValidation(validationState);
  } catch (error) {
    setLibraryMessage(`Validation updated, but saving failed: ${error.message || error}`, 'warn');
  }
}

async function loadWidgetFromUpload(file) {
  if (!file) return;
  const uploadToken = ++activeUploadToken;

  try {
    if (file.size > MAX_CLIENT_UPLOAD_BYTES) {
      resetCurrentWidgetState();
      const maxMb = Math.round((MAX_CLIENT_UPLOAD_BYTES / (1024 * 1024)) * 10) / 10;
      setValidationState({
        level: 'fail',
        badge: 'Failed',
        summary: 'Validation did not complete.',
        details: `File too large. Maximum supported size is ${maxMb} MB.`,
        source: null,
        cliAvailable: null,
        fileCount: null,
        widgetName: null,
        widgetVersion: null
      });
      setStatusMessage(`Failed to load widget: file exceeds ${maxMb} MB limit.`);
      setLibraryMessage('', 'neutral');
      return;
    }

    const bytes = await file.arrayBuffer();
    currentWidgetRecordId = null;
    renderLibrary();
    setStatusMessage(`Loading ${file.name}...`);
    setLibraryMessage('', 'neutral');
    setValidationState({
      level: 'warn',
      badge: 'Running',
      summary: 'Running validation...',
      details: '',
      source: null,
      cliAvailable: null,
      fileCount: null,
      widgetName: null,
      widgetVersion: null
    });

    await loadWidgetArchive({
      fileName: file.name,
      bytes,
      preferredLayoutId: null,
      initialSettings: {
        viewportKey: DEFAULT_VIEWPORT_KEY,
        values: {},
        proxyEnabled: false
      }
    });
    await updateFrame(true);

    const validationState = await runAutoValidation(file.name, bytes);
    setValidationState(validationState);

    try {
      await saveUploadedWidgetToLibrary({
        fileName: file.name,
        bytes,
        manifest: loadedManifest,
        validationState,
        fileCount: currentPackageFileCount
      });
      setTransientLibraryMessage('Saved to local widget library.', 'pass');
    } catch (error) {
      if (error?.isStorageGuard || error?.name === 'QuotaExceededError') {
        setLibraryMessage(error.message || 'Widget previewed, but local storage is full.', 'warn');
      } else {
        setLibraryMessage(`Widget previewed, but could not be saved: ${error.message || error}`, 'warn');
      }
    }
  } catch (error) {
    resetCurrentWidgetState();
    setValidationState({
      level: 'fail',
      badge: 'Failed',
      summary: 'Validation did not complete.',
      details: String(error.message || error),
      source: null,
      cliAvailable: null,
      fileCount: null,
      widgetName: null,
      widgetVersion: null
    });
    setStatusMessage(`Failed to load widget: ${error.message || error}`);
    setLibraryMessage(error.message || String(error), 'fail');
  } finally {
    if (uploadToken === activeUploadToken) {
      widgetFileInput.value = '';
    }
    renderLibrary();
    updateActionButtons();
  }
}

async function loadWidgetFromLibraryRecord(record) {
  currentWidgetRecordId = record.localId;
  renderLibrary();
  setTransientLibraryMessage(`Loading ${record.fileName} from local library...`, 'neutral');

  try {
    await loadWidgetArchive({
      fileName: record.fileName,
      bytes: record.bytes,
      preferredLayoutId: record.settings?.layoutId || null,
      initialSettings: {
        ...(record.settings || {}),
        ...(record.runtimeSettings || {})
      }
    });

    setValidationState(record.validation
      ? {
          level: record.validation.level || 'neutral',
          badge: record.validation.badge || getValidationLabel(record.validation.level),
          summary: record.validation.summary || 'No validation run yet.',
          details: record.validation.details || '',
          source: record.validation.source || null,
          cliAvailable: typeof record.validation.cliAvailable === 'boolean' ? record.validation.cliAvailable : null,
          fileCount: record.validation.fileCount ?? record.fileCount ?? null,
          widgetName: record.validation.widgetName || record.manifestName || null,
          widgetVersion: record.validation.widgetVersion || record.manifestVersion || null
        }
      : createEmptyValidationState()
    );

    await updateFrame(true);
    setStatusMessage('');
    setTransientLibraryMessage('Loaded from local widget library.', 'pass');
    updateActionButtons();
    switchInspectorTab('preview');
    persistCurrentWidgetSettings().catch(() => {});
  } catch (error) {
    setLibraryMessage(`Saved widget failed to load: ${error.message || error}`, 'fail');
    throw error;
  }
}

async function deleteCurrentWidget() {
  if (!currentWidgetRecordId) return;
  const recordId = currentWidgetRecordId;
  await deleteWidgetRecord(recordId);
  libraryRecords = libraryRecords.filter((record) => record.localId !== recordId);
  currentWidgetRecordId = null;
  resetCurrentWidgetState();
  renderLibrary();
  setStatusMessage('Widget removed from the local library.');
  setTransientLibraryMessage('Deleted widget from local library.', 'pass');
}

async function clearLibrary() {
  await clearWidgetRecords();
  libraryRecords = [];
  currentWidgetRecordId = null;
  resetCurrentWidgetState();
  renderLibrary();
  setStatusMessage('Library cleared.');
  setTransientLibraryMessage('Library cleared.', 'pass');
}

async function bootstrapLibrary() {
  try {
    libraryRecords = await getAllWidgetRecords();
    renderLibrary();
    if (libraryRecords.length) {
      setLibraryMessage('Saved widgets are ready to re-open locally.', 'neutral');
    }
  } catch (error) {
    setLibraryMessage(`Local widget storage is unavailable: ${error.message || error}`, 'fail');
  }
}

uploadButton.addEventListener('click', () => {
  widgetFileInput.click();
});

previewTabButton.addEventListener('click', () => {
  switchInspectorTab('preview');
});

settingsTabButton.addEventListener('click', () => {
  switchInspectorTab('settings');
});

packageTabButton.addEventListener('click', () => {
  switchInspectorTab('package');
});

toggleValidationButton.addEventListener('click', () => {
  if (!currentValidationState?.details) return;
  setValidationDetailsExpanded(!validationDetailsExpanded);
});

function handleFileSelection(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  void loadWidgetFromUpload(file);
}

widgetFileInput.addEventListener('change', handleFileSelection);

viewportSelect.addEventListener('change', () => {
  void updateFrame().catch((error) => showPreviewRoutingFailure(error.message || String(error)));
  persistCurrentWidgetSettings().catch(() => {});
});

reloadPreviewButton.addEventListener('click', () => {
  if (!currentSessionId) return;
  previewReloadNonce = Date.now();
  void updateFrame(true).then(() => {
    setStatusMessage('Preview reloaded.');
  }).catch((error) => {
    showPreviewRoutingFailure(error.message || String(error));
  });
});

revalidateButton.addEventListener('click', () => {
  revalidateCurrentWidget().catch((error) => {
    setValidationState({
      level: 'fail',
      badge: 'Failed',
      summary: 'Validation failed to run.',
      details: String(error.message || error),
      source: null,
      cliAvailable: null,
      fileCount: currentPackageFileCount,
      widgetName: loadedManifest?.name || null,
      widgetVersion: loadedManifest?.version || null
    });
  });
});

deleteWidgetButton.addEventListener('click', () => {
  deleteCurrentWidget().catch((error) => {
    setLibraryMessage(`Could not delete widget: ${error.message || error}`, 'fail');
  });
});

clearLibraryButton.addEventListener('click', () => {
  clearLibrary().catch((error) => {
    setLibraryMessage(`Could not clear library: ${error.message || error}`, 'fail');
  });
});

resetSettingsButton.addEventListener('click', () => {
  resetRuntimeSettingsToDefaults().catch((error) => {
    setLibraryMessage(`Could not reset widget settings: ${error.message || error}`, 'fail');
  });
});

proxyEnabledInput.addEventListener('change', () => {
  handleProxyToggleChange().catch((error) => {
    setLibraryMessage(`Could not update proxy setting: ${error.message || error}`, 'fail');
  });
});

window.addEventListener('resize', () => {
  void updateFrame().catch((error) => showPreviewRoutingFailure(error.message || String(error)));
});
widgetFrame.addEventListener('load', () => sendSettingsToPreviewFrame());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== 'WIDGET_ASSET_WARNING') return;
    if (!currentSessionId || data.sessionId !== currentSessionId) return;

    widgetAssetWarnings.push({
      path: typeof data.path === 'string' ? data.path : '',
      reason: typeof data.reason === 'string' ? data.reason : 'missing'
    });
    renderAssetWarnings();
  });
}

function handleBridgeTelemetry(data) {
  switch (data.type) {
    case 'ICUE_PREVIEW_BRIDGE_READY':
      console.log('[XENEON bridge] ready');
      break;
    case 'ICUE_PREVIEW_SETTINGS_APPLIED':
      console.log('[XENEON bridge] settings applied —', data.keys?.length, 'keys, proxyEnabled:', data.proxyEnabled);
      break;
    case 'ICUE_PREVIEW_FETCH_INTERCEPTED':
      console.log('[XENEON bridge] fetch intercepted:', data.url);
      break;
    case 'ICUE_PREVIEW_XHR_INTERCEPTED':
      console.log('[XENEON bridge] XHR intercepted:', data.url);
      break;
    case 'ICUE_PREVIEW_HOOK_CALLED':
      console.log('[XENEON bridge] hook called:', data.hook);
      break;
    case 'ICUE_PREVIEW_BRIDGE_ERROR':
      console.warn('[XENEON bridge] error:', data.message);
      break;
    default:
      break;
  }
}

function isMessageFromWidgetFrame(event) {
  return Boolean(event?.source && widgetFrame.contentWindow && event.source === widgetFrame.contentWindow);
}

window.addEventListener('message', (event) => {
  if (!isMessageFromWidgetFrame(event)) return;
  const data = event.data || {};
  if (!data.type) return;
  if (data.type.startsWith('ICUE_PREVIEW_BRIDGE') || data.type === 'ICUE_PREVIEW_SETTINGS_APPLIED' ||
      data.type === 'ICUE_PREVIEW_FETCH_INTERCEPTED' || data.type === 'ICUE_PREVIEW_XHR_INTERCEPTED' ||
      data.type === 'ICUE_PREVIEW_HOOK_CALLED') {
    handleBridgeTelemetry(data);
    return;
  }
  if (data.type !== 'ICUE_PREVIEW_PROXY_REQUEST' || !data.requestId || !event.source) return;
  handleProxyRequestMessage(data, event.source).catch((error) => {
    event.source.postMessage({
      type: 'ICUE_PREVIEW_PROXY_RESPONSE',
      requestId: data.requestId,
      ok: false,
      error: String(error.message || error)
    }, '*');
  });
});

renderSettingsPanel();
setValidationState(createEmptyValidationState());
setValidationDetailsExpanded(false);
switchInspectorTab('preview');
updatePackageInfo();
void updateFrame(true).catch((error) => showPreviewRoutingFailure(error.message || String(error)));
updateActionButtons();
bootstrapLibrary();

if ('serviceWorker' in navigator) {
  ensureServiceWorkerReady().catch((error) => {
    if (!error) return;
    setStatusMessage(error.message || String(error));
  });
} else {
  setStatusMessage('This browser does not support Service Workers.');
}
