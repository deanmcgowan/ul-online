import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "gtfs.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("synchronous = NORMAL");
    _db.exec(`
      CREATE TABLE IF NOT EXISTS transit_stops (
        stop_id   TEXT PRIMARY KEY,
        stop_name TEXT NOT NULL,
        stop_lat  REAL NOT NULL,
        stop_lon  REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transit_routes (
        route_id         TEXT PRIMARY KEY,
        route_short_name TEXT NOT NULL DEFAULT '',
        route_long_name  TEXT NOT NULL DEFAULT '',
        route_type       INTEGER NOT NULL DEFAULT 3
      );
      CREATE TABLE IF NOT EXISTS transit_trips (
        trip_id  TEXT PRIMARY KEY,
        route_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stop_times (
        trip_id        TEXT NOT NULL,
        stop_id        TEXT NOT NULL,
        stop_sequence  INTEGER NOT NULL,
        arrival_time   TEXT NOT NULL DEFAULT '',
        departure_time TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (trip_id, stop_sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_stop_times_trip ON stop_times(trip_id);
      CREATE INDEX IF NOT EXISTS idx_stop_times_stop ON stop_times(stop_id);
      CREATE TABLE IF NOT EXISTS stop_routes (
        stop_id  TEXT NOT NULL,
        route_id TEXT NOT NULL,
        PRIMARY KEY (stop_id, route_id)
      );
      CREATE TABLE IF NOT EXISTS static_data_meta (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id         TEXT PRIMARY KEY,
        endpoint   TEXT NOT NULL UNIQUE,
        p256dh     TEXT NOT NULL,
        auth       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS scheduled_notifications (
        id              TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        notify_at       TEXT NOT NULL,
        title           TEXT NOT NULL,
        body            TEXT NOT NULL,
        sent_at         TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_notify_at ON scheduled_notifications(notify_at);
    `);
  }
  return _db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
