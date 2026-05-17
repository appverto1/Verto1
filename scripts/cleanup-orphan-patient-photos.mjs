#!/usr/bin/env node

/**
 * Cleanup confirmed orphan files from the Supabase Storage bucket `patient-photos`.
 *
 * What this script does:
 * 1. Recursively lists every object in `patient-photos`
 * 2. Loads active history photo references from `history.image` and `history.image_path`
 * 3. Filters only the confirmed orphan candidates:
 *    - filenames containing `Pereira.jpg`
 *    - filenames starting with `profile-` inside a UUID root folder
 * 4. Deletes them through the Supabase Storage Admin API
 * 5. Logs each deletion with path and size
 *
 * Usage:
 *   node scripts/cleanup-orphan-patient-photos.mjs --dry-run
 *   node scripts/cleanup-orphan-patient-photos.mjs --delete
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const args = new Set(process.argv.slice(2));
const isDryRun = !args.has('--delete') || args.has('--dry-run');
const PAGE_SIZE = 1000;
const UUID_ROOT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\//i;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1');
    env[key] = value;
  }
  return env;
}

const env = {
  ...readEnvFile(path.resolve('.env.local')),
  ...readEnvFile(path.resolve('.env'))
};

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  env.VITE_SUPABASE_URL ||
  env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials. Set VITE_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(2)} KB`;
  return `${size} B`;
}

function extractHistoryStoragePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (raw.startsWith('patient-photos/')) {
    return raw.slice('patient-photos/'.length);
  }

  const signedMarker = '/storage/v1/object/sign/patient-photos/';
  if (raw.includes(signedMarker)) {
    const encodedPath = raw.split(signedMarker)[1]?.split('?')[0] || '';
    if (encodedPath) return decodeURIComponent(encodedPath);
  }

  const publicMarker = '/storage/v1/object/public/patient-photos/';
  if (raw.includes(publicMarker)) {
    const encodedPath = raw.split(publicMarker)[1]?.split('?')[0] || '';
    if (encodedPath) return decodeURIComponent(encodedPath);
  }

  if (/^[0-9a-f-]{36}\//i.test(raw)) {
    return raw;
  }

  return null;
}

async function listBucketRecursively(prefix = '') {
  const results = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin.storage
      .from('patient-photos')
      .list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' }
      });

    if (error) throw error;

    const items = Array.isArray(data) ? data : [];
    for (const item of items) {
      const itemName = String(item?.name || '').trim();
      if (!itemName) continue;
      const fullPath = prefix ? `${prefix}/${itemName}` : itemName;
      const isFolder = !item?.id;
      if (isFolder) {
        const nested = await listBucketRecursively(fullPath);
        results.push(...nested);
      } else {
        results.push({
          ...item,
          path: fullPath,
          size: Number(item?.metadata?.size ?? item?.size ?? 0) || 0
        });
      }
    }

    if (items.length < PAGE_SIZE) break;
    offset += items.length;
  }

  return results;
}

async function loadReferencedPaths() {
  const referenced = new Set();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('history')
      .select('id,image,image_path')
      .eq('type', 'photo')
      .is('deleted_at', null)
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const direct = extractHistoryStoragePath(row?.image_path);
      if (direct) referenced.add(direct);
      const fromImage = extractHistoryStoragePath(row?.image);
      if (fromImage) referenced.add(fromImage);
    }

    if (rows.length < pageSize) break;
    from += rows.length;
  }

  return referenced;
}

function isConfirmedCandidate(objectPath) {
  const lower = String(objectPath || '').toLowerCase();
  return (
    lower.includes('pereira.jpg') ||
    (UUID_ROOT_RE.test(objectPath) && /^profile-/i.test(objectPath.split('/').slice(1).join('/')))
  );
}

async function removeInBatches(objects) {
  const batches = [];
  for (let i = 0; i < objects.length; i += 100) {
    batches.push(objects.slice(i, i + 100));
  }

  for (const batch of batches) {
    const paths = batch.map((item) => item.path);
    const { error } = await supabaseAdmin.storage.from('patient-photos').remove(paths);
    if (error) throw error;

    for (const item of batch) {
      console.log(`[deleted] ${item.path} | ${formatBytes(item.size)}`);
    }
  }
}

async function main() {
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'DELETE'}`);
  console.log('Listing patient-photos recursively...');
  const allObjects = await listBucketRecursively('');
  console.log(`Objects found: ${allObjects.length}`);

  console.log('Loading active history photo references...');
  const referencedPaths = await loadReferencedPaths();
  console.log(`Referenced paths: ${referencedPaths.size}`);

  const orphanCandidates = allObjects
    .filter((item) => isConfirmedCandidate(item.path))
    .filter((item) => !referencedPaths.has(item.path));

  const totalBytes = orphanCandidates.reduce((sum, item) => sum + Number(item.size || 0), 0);

  console.log(`Confirmed orphan candidates: ${orphanCandidates.length}`);
  console.log(`Estimated reclaimed space: ${formatBytes(totalBytes)}`);

  if (!orphanCandidates.length) {
    console.log('Nothing to delete.');
    return;
  }

  for (const item of orphanCandidates) {
    console.log(`[orphan] ${item.path} | ${formatBytes(item.size)}`);
  }

  if (isDryRun) {
    console.log('Dry run complete. Re-run with --delete to remove these objects.');
    return;
  }

  await removeInBatches(orphanCandidates);
  console.log('Cleanup complete.');
}

main().catch((error) => {
  console.error('Cleanup failed:', error?.message || error);
  process.exit(1);
});
