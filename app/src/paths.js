// @ts-check
/**
 * Vaste paden van de app: publieke bestanden en de dataopslag (afbeeldingen uit de import).
 */
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(APP_DIR, 'data'));
const MEDIA_DIR = path.join(DATA_DIR, 'media');

module.exports = { APP_DIR, PUBLIC_DIR, DATA_DIR, MEDIA_DIR };
