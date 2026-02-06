const express = require('express');
const { supabase } = require('../config/supabase');
const { StorageService } = require('../services/storageService');

const router = express.Router();
const storageService = new StorageService();

/**
 * GET /player/:deviceCode
 * Get playlist content for a specific screen device
 */
router.get('/:deviceCode', async (req, res) => {
  try {
    const { deviceCode } = req.params;
    console.log('🎬 Player content request for device code:', deviceCode);

    if (!deviceCode) {
      return res.status(400).json({
        error: 'Device code is required',
        code: 'MISSING_DEVICE_CODE'
      });
    }

    // Find screen by device code
    const { data: screen, error: screenError } = await supabase
      .from('screens')
      .select('id, name, status')
      .eq('device_code', deviceCode)
      .single();

    console.log('🎬 Screen lookup result:', { screen, screenError });

    if (screenError || !screen) {
      console.log('❌ Screen not found for device code:', deviceCode);
      return res.status(404).json({
        error: 'Screen not found',
        code: 'SCREEN_NOT_FOUND'
      });
    }

    // Get assigned playlist for this screen
    const { data: assignment, error: assignmentError } = await supabase
      .from('screen_assignments')
      .select(`
        playlist_id,
        playlists (
          id,
          name,
          description
        )
      `)
      .eq('screen_id', screen.id)
      .single();

    console.log('🎬 Assignment lookup result:', { assignment, assignmentError });

    if (assignmentError || !assignment) {
      console.log('📋 No playlist assigned to screen:', screen.name);
      return res.json({
        success: true,
        screen: {
          id: screen.id,
          name: screen.name,
          status: screen.status
        },
        playlist: null,
        content: [],
        message: 'No playlist assigned to this screen'
      });
    }

    // Get playlist items with media details
    const { data: playlistItems, error: itemsError } = await supabase
      .from('playlist_items')
      .select(`
        id,
        order_index,
        duration,
        media (
          id,
          name,
          type,
          file_path,
          mime_type,
          duration
        )
      `)
      .eq('playlist_id', assignment.playlist_id)
      .order('order_index', { ascending: true });

    console.log('🎬 Playlist items result:', { 
      playlistId: assignment.playlist_id,
      itemsCount: playlistItems?.length || 0,
      itemsError 
    });

    if (itemsError) {
      throw new Error(`Playlist items query failed: ${itemsError.message}`);
    }

    // Format content with public URLs
    const content = playlistItems.map(item => ({
      id: item.id,
      order: item.order_index,
      duration: item.duration,
      media: {
        id: item.media.id,
        name: item.media.name,
        type: item.media.type,
        url: storageService.getPublicUrl(item.media.file_path),
        mimeType: item.media.mime_type,
        mediaDuration: item.media.duration
      }
    }));

    console.log('🎬 Formatted content:', {
      contentCount: content.length,
      firstItem: content[0] ? {
        name: content[0].media.name,
        type: content[0].media.type,
        url: content[0].media.url
      } : null
    });

    const response = {
      success: true,
      screen: {
        id: screen.id,
        name: screen.name,
        status: screen.status
      },
      playlist: {
        id: assignment.playlists.id,
        name: assignment.playlists.name,
        description: assignment.playlists.description,
        totalItems: content.length,
        totalDuration: content.reduce((sum, item) => sum + item.duration, 0)
      },
      content,
      timestamp: new Date().toISOString()
    };

    console.log('✅ Sending playlist response:', {
      playlistName: response.playlist.name,
      itemCount: response.content.length
    });

    res.json(response);
  } catch (error) {
    console.error('❌ Player content error:', error);
    res.status(500).json({
      error: 'Failed to fetch player content',
      code: 'PLAYER_CONTENT_ERROR'
    });
  }
});

/**
 * POST /player/:deviceCode/heartbeat
 * Update screen status and last heartbeat
 */
router.post('/:deviceCode/heartbeat', async (req, res) => {
  try {
    const { deviceCode } = req.params;
    const { status = 'online', playerInfo = {} } = req.body;

    if (!deviceCode) {
      return res.status(400).json({
        error: 'Device code is required',
        code: 'MISSING_DEVICE_CODE'
      });
    }

    // Update screen heartbeat and status
    const { data: screen, error: updateError } = await supabase
      .from('screens')
      .update({
        status: status,
        last_heartbeat: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('device_code', deviceCode)
      .select('id, name, status')
      .single();

    if (updateError) {
      if (updateError.code === 'PGRST116') {
        return res.status(404).json({
          error: 'Screen not found',
          code: 'SCREEN_NOT_FOUND'
        });
      }
      throw new Error(`Heartbeat update failed: ${updateError.message}`);
    }

    res.json({
      success: true,
      screen: {
        id: screen.id,
        name: screen.name,
        status: screen.status
      },
      timestamp: new Date().toISOString(),
      message: 'Heartbeat received'
    });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({
      error: 'Failed to process heartbeat',
      code: 'HEARTBEAT_ERROR'
    });
  }
});

/**
 * GET /player/:deviceCode/status
 * Get current screen status and basic info
 */
router.get('/:deviceCode/status', async (req, res) => {
  try {
    const { deviceCode } = req.params;

    if (!deviceCode) {
      return res.status(400).json({
        error: 'Device code is required',
        code: 'MISSING_DEVICE_CODE'
      });
    }

    // Get screen info
    const { data: screen, error: screenError } = await supabase
      .from('screens')
      .select('id, name, status, last_heartbeat, location')
      .eq('device_code', deviceCode)
      .single();

    if (screenError || !screen) {
      return res.status(404).json({
        error: 'Screen not found',
        code: 'SCREEN_NOT_FOUND'
      });
    }

    // Check if screen has an assigned playlist
    const { data: assignment, error: assignmentError } = await supabase
      .from('screen_assignments')
      .select(`
        playlists (
          id,
          name
        )
      `)
      .eq('screen_id', screen.id)
      .single();

    const hasPlaylist = !assignmentError && assignment;

    res.json({
      success: true,
      screen: {
        id: screen.id,
        name: screen.name,
        status: screen.status,
        location: screen.location,
        lastHeartbeat: screen.last_heartbeat,
        hasPlaylist: hasPlaylist,
        playlist: hasPlaylist ? {
          id: assignment.playlists.id,
          name: assignment.playlists.name
        } : null
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Player status error:', error);
    res.status(500).json({
      error: 'Failed to fetch player status',
      code: 'PLAYER_STATUS_ERROR'
    });
  }
});

/**
 * POST /player/:deviceCode/error
 * Report player errors for monitoring
 */
router.post('/:deviceCode/error', async (req, res) => {
  try {
    const { deviceCode } = req.params;
    const { error: errorMessage, details = {} } = req.body;

    if (!deviceCode || !errorMessage) {
      return res.status(400).json({
        error: 'Device code and error message are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }

    // Log the error (in a production system, you might want to store this in a separate errors table)
    console.error('Player error reported:', {
      deviceCode,
      error: errorMessage,
      details,
      timestamp: new Date().toISOString()
    });

    // Update screen status to indicate error
    const { error: updateError } = await supabase
      .from('screens')
      .update({
        status: 'offline', // Mark as offline when errors occur
        last_heartbeat: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('device_code', deviceCode);

    if (updateError) {
      console.error('Failed to update screen status after error:', updateError);
    }

    res.json({
      success: true,
      message: 'Error reported successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error reporting error:', error);
    res.status(500).json({
      error: 'Failed to report error',
      code: 'ERROR_REPORTING_ERROR'
    });
  }
});

/**
 * POST /player/:deviceCode/playlist-change
 * Report playlist change events for monitoring
 */
router.post('/:deviceCode/playlist-change', async (req, res) => {
  try {
    const { deviceCode } = req.params;
    const { playlistId, playlistName, itemCount, changeType } = req.body;

    if (!deviceCode) {
      return res.status(400).json({
        error: 'Device code is required',
        code: 'MISSING_DEVICE_CODE'
      });
    }

    // Log the playlist change (in a production system, you might want to store this in a separate events table)
    console.log('Playlist change reported:', {
      deviceCode,
      playlistId,
      playlistName,
      itemCount,
      changeType,
      timestamp: new Date().toISOString()
    });

    // Update screen's last activity
    const { error: updateError } = await supabase
      .from('screens')
      .update({
        last_heartbeat: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('device_code', deviceCode);

    if (updateError) {
      console.error('Failed to update screen after playlist change:', updateError);
    }

    res.json({
      success: true,
      message: 'Playlist change reported successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Playlist change reporting error:', error);
    res.status(500).json({
      error: 'Failed to report playlist change',
      code: 'PLAYLIST_CHANGE_ERROR'
    });
  }
});

/**
 * GET /player/:deviceCode/fix-storage
 * Fix storage bucket permissions
 */
router.get('/:deviceCode/fix-storage', async (req, res) => {
  try {
    const { deviceCode } = req.params;
    console.log('🔧 Fixing storage permissions for device:', deviceCode);

    // Check if bucket exists and is public
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    
    if (listError) {
      throw new Error(`Failed to list buckets: ${listError.message}`);
    }

    const mediaBucket = buckets.find(bucket => bucket.name === 'media');
    
    if (!mediaBucket) {
      // Create the bucket
      const { error: createError } = await supabase.storage.createBucket('media', {
        public: true,
        allowedMimeTypes: [
          'image/jpeg', 'image/png', 'image/gif', 'image/webp',
          'video/mp4', 'video/webm', 'video/ogg'
        ],
        fileSizeLimit: 52428800 // 50MB
      });

      if (createError) {
        throw new Error(`Failed to create bucket: ${createError.message}`);
      }

      console.log('✅ Created media bucket');
    }

    // Try to make bucket public (this might require admin permissions)
    const { error: updateError } = await supabase.storage.updateBucket('media', {
      public: true
    });

    if (updateError) {
      console.warn('⚠️ Could not update bucket to public:', updateError.message);
    }

    // Test the specific file
    const filePath = '23a983f5-ffc5-4ee9-b3dd-402d255688df/1770211648662-6owgt7hd2ac.png';
    const { data: { publicUrl } } = supabase.storage
      .from('media')
      .getPublicUrl(filePath);

    console.log('🔍 Testing public URL:', publicUrl);

    res.json({
      success: true,
      bucket: mediaBucket || 'created',
      publicUrl: publicUrl,
      message: 'Storage configuration checked',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Storage fix error:', error);
    res.status(500).json({
      error: 'Failed to fix storage',
      message: error.message
    });
  }
});

/**
 * GET /player/:deviceCode/test-media
 * Test media URLs for debugging
 */
router.get('/:deviceCode/test-media', async (req, res) => {
  try {
    const { deviceCode } = req.params;
    console.log('🖼️ Testing media URLs for device code:', deviceCode);

    // Get the playlist content (same as main endpoint)
    const { data: screen, error: screenError } = await supabase
      .from('screens')
      .select('id, name')
      .eq('device_code', deviceCode)
      .single();

    if (screenError || !screen) {
      return res.status(404).json({ error: 'Screen not found' });
    }

    const { data: assignment, error: assignmentError } = await supabase
      .from('screen_assignments')
      .select('playlist_id')
      .eq('screen_id', screen.id)
      .single();

    if (assignmentError || !assignment) {
      return res.json({ error: 'No assignment found' });
    }

    const { data: playlistItems, error: itemsError } = await supabase
      .from('playlist_items')
      .select(`
        id,
        order_index,
        duration,
        media (
          id,
          name,
          type,
          file_path,
          mime_type
        )
      `)
      .eq('playlist_id', assignment.playlist_id)
      .order('order_index', { ascending: true });

    if (itemsError || !playlistItems || playlistItems.length === 0) {
      return res.json({ error: 'No playlist items found' });
    }

    // Test each media URL
    const mediaTests = playlistItems.map(item => {
      const publicUrl = storageService.getPublicUrl(item.media.file_path);
      
      return {
        id: item.media.id,
        name: item.media.name,
        type: item.media.type,
        filePath: item.media.file_path,
        publicUrl: publicUrl,
        mimeType: item.media.mime_type,
        duration: item.duration
      };
    });

    console.log('🖼️ Generated media URLs:', mediaTests);

    res.json({
      success: true,
      screen: screen.name,
      mediaCount: mediaTests.length,
      mediaItems: mediaTests,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Media test error:', error);
    res.status(500).json({
      error: 'Failed to test media URLs',
      message: error.message
    });
  }
});

/**
 * POST /player/:deviceCode/quick-assign
 * Quick assignment endpoint for debugging - assigns the first available playlist to the screen
 */
router.post('/:deviceCode/quick-assign', async (req, res) => {
  try {
    const { deviceCode } = req.params;
    console.log('🔧 Quick assign request for device code:', deviceCode);

    if (!deviceCode) {
      return res.status(400).json({
        error: 'Device code is required',
        code: 'MISSING_DEVICE_CODE'
      });
    }

    // Find screen by device code
    const { data: screen, error: screenError } = await supabase
      .from('screens')
      .select('id, name')
      .eq('device_code', deviceCode)
      .single();

    if (screenError || !screen) {
      return res.status(404).json({
        error: 'Screen not found',
        code: 'SCREEN_NOT_FOUND'
      });
    }

    // Get the first available playlist
    const { data: playlists, error: playlistsError } = await supabase
      .from('playlists')
      .select('id, name')
      .limit(1);

    if (playlistsError || !playlists || playlists.length === 0) {
      return res.status(404).json({
        error: 'No playlists available',
        code: 'NO_PLAYLISTS'
      });
    }

    const playlist = playlists[0];

    // Check if assignment already exists
    const { data: existingAssignment, error: checkError } = await supabase
      .from('screen_assignments')
      .select('id')
      .eq('screen_id', screen.id)
      .single();

    if (existingAssignment) {
      // Update existing assignment
      const { data, error } = await supabase
        .from('screen_assignments')
        .update({
          playlist_id: playlist.id,
          assigned_at: new Date().toISOString()
        })
        .eq('screen_id', screen.id)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update assignment: ${error.message}`);
      }

      console.log('✅ Updated assignment:', { screenName: screen.name, playlistName: playlist.name });
    } else {
      // Create new assignment
      const { data, error } = await supabase
        .from('screen_assignments')
        .insert({
          screen_id: screen.id,
          playlist_id: playlist.id,
          assigned_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create assignment: ${error.message}`);
      }

      console.log('✅ Created assignment:', { screenName: screen.name, playlistName: playlist.name });
    }

    res.json({
      success: true,
      message: 'Assignment created successfully',
      screen: {
        id: screen.id,
        name: screen.name
      },
      playlist: {
        id: playlist.id,
        name: playlist.name
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Quick assign error:', error);
    res.status(500).json({
      error: 'Failed to create assignment',
      message: error.message
    });
  }
});

/**
 * GET /player/:deviceCode/debug
 * Debug endpoint to check screen and playlist assignment
 */
router.get('/:deviceCode/debug', async (req, res) => {
  try {
    const { deviceCode } = req.params;
    console.log('🔍 Debug request for device code:', deviceCode);

    if (!deviceCode) {
      return res.status(400).json({
        error: 'Device code is required',
        code: 'MISSING_DEVICE_CODE'
      });
    }

    // Find screen by device code
    const { data: screen, error: screenError } = await supabase
      .from('screens')
      .select('*')
      .eq('device_code', deviceCode)
      .single();

    console.log('🔍 Screen query result:', { screen, screenError });

    if (screenError || !screen) {
      return res.json({
        debug: true,
        deviceCode,
        screen: null,
        screenError: screenError?.message,
        message: 'Screen not found'
      });
    }

    // Get assigned playlist for this screen
    const { data: assignments, error: assignmentError } = await supabase
      .from('screen_assignments')
      .select(`
        *,
        playlists (*)
      `)
      .eq('screen_id', screen.id);

    console.log('🔍 Assignment query result:', { assignments, assignmentError });

    // Get all playlists for reference
    const { data: allPlaylists, error: playlistsError } = await supabase
      .from('playlists')
      .select('*');

    console.log('🔍 All playlists:', { allPlaylists, playlistsError });

    // If there's an assignment, get playlist items
    let playlistItems = null;
    if (assignments && assignments.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from('playlist_items')
        .select(`
          *,
          media (*)
        `)
        .eq('playlist_id', assignments[0].playlist_id)
        .order('order_index', { ascending: true });

      console.log('🔍 Playlist items:', { items, itemsError });
      playlistItems = { items, itemsError };
    }

    res.json({
      debug: true,
      deviceCode,
      screen,
      assignments,
      allPlaylists,
      playlistItems,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({
      debug: true,
      error: error.message,
      stack: error.stack
    });
  }
});

module.exports = router;