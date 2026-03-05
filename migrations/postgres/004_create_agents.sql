-- Agent table removed: the platform connects directly to brokers.
-- This migration drops the table if it exists from a previous installation.
DROP TABLE IF EXISTS agents;
