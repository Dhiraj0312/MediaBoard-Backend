const { supabase } = require('../config/supabase');

/**
 * Validate Supabase configuration and setup
 */
async function validateSupabaseSetup() {
  const results = {
    connection: false,
    database: false,
    storage: false,
    auth: false,
    errors: []
  };

  try {
    // Test 1: Basic connection
    const { data: healthData, error: healthError } = await supabase
      .from('profiles')
      .select('count')
      .limit(1);

    if (healthError && healthError.code !== 'PGRST116') {
      results.errors.push(`Database connection failed: ${healthError.message}`);
    } else {
      results.connection = true;
    }

    // Test 2: Database schema
    const tables = ['profiles', 'screens', 'media', 'playlists', 'playlist_items', 'screen_assignments'];
    let allTablesExist = true;

    for (const table of tables) {
      const { error } = await supabase
        .from(table)
        .select('count')
        .limit(1);

      if (error && error.code === 'PGRST116') {
        results.errors.push(`Table '${table}' does not exist`);
        allTablesExist = false;
      }
    }

    results.database = allTablesExist;

    // Test 3: Storage bucket
    const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
    
    if (bucketError) {
      results.errors.push(`Storage access failed: ${bucketError.message}`);
    } else {
      const mediaBucket = buckets.find(bucket => bucket.name === 'media');
      if (!mediaBucket) {
        results.errors.push('Media storage bucket does not exist');
      } else {
        results.storage = true;
      }
    }

    // Test 4: Auth configuration
    try {
      // This will fail if auth is not properly configured
      const { data: { user }, error: authError } = await supabase.auth.getUser('invalid-token');
      // We expect this to fail, but not throw an error
      results.auth = true;
    } catch (error) {
      results.errors.push(`Auth service error: ${error.message}`);
    }

  } catch (error) {
    results.errors.push(`General error: ${error.message}`);
  }

  return results;
}

/**
 * Print validation results
 */
function printValidationResults(results) {
  console.log('\n🔍 Supabase Configuration Validation\n');
  
  console.log(`Database Connection: ${results.connection ? '✅' : '❌'}`);
  console.log(`Database Schema: ${results.database ? '✅' : '❌'}`);
  console.log(`Storage Bucket: ${results.storage ? '✅' : '❌'}`);
  console.log(`Auth Service: ${results.auth ? '✅' : '❌'}`);

  if (results.errors.length > 0) {
    console.log('\n❌ Issues found:');
    results.errors.forEach(error => console.log(`  - ${error}`));
    
    console.log('\n🔧 Troubleshooting steps:');
    console.log('1. Ensure your Supabase project is active');
    console.log('2. Run database/schema.sql in your Supabase SQL editor');
    console.log('3. Create the "media" storage bucket in Supabase dashboard');
    console.log('4. Run database/storage-policies.sql in your Supabase SQL editor');
    console.log('5. Check your environment variables');
  } else {
    console.log('\n🎉 All checks passed! Supabase is properly configured.');
  }

  return results.connection && results.database && results.storage && results.auth;
}

module.exports = { validateSupabaseSetup, printValidationResults };