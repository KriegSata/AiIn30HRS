-- Executed only on native PostgreSQL; production requires PostGIS installed by the database administrator.
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE organizations ADD COLUMN location_geog geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography) STORED;
ALTER TABLE listings ADD COLUMN location_geog geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography) STORED;
ALTER TABLE lots ADD COLUMN origin_geog geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(origin_longitude,origin_latitude),4326)::geography) STORED;
CREATE INDEX organizations_location_gist ON organizations USING gist(location_geog);
CREATE INDEX listings_location_gist ON listings USING gist(location_geog);
CREATE INDEX lots_origin_gist ON lots USING gist(origin_geog);
