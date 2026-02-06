const { supabase } = require('./src/config/supabase.js');

async function createAdminUser() {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.log('Usage: node create-admin.js <email> <password>');
    console.log('Example: node create-admin.js admin@example.com mypassword123');
    process.exit(1);
  }

  try {
    console.log(`🔐 Creating admin user: ${email}`);

    // Create user in Supabase Auth
    const { data, error } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true
    });

    if (error) {
      console.error('❌ Failed to create user:', error.message);
      process.exit(1);
    }

    console.log('✅ User created successfully!');
    console.log('📧 Email:', data.user.email);
    console.log('🆔 User ID:', data.user.id);

    // Check if profile was created automatically
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError) {
      console.log('⚠️  Profile not found, creating manually...');
      
      // Create profile manually
      const { error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: data.user.id,
          email: data.user.email
        });

      if (insertError) {
        console.error('❌ Failed to create profile:', insertError.message);
      } else {
        console.log('✅ Profile created successfully!');
      }
    } else {
      console.log('✅ Profile already exists!');
    }

    console.log('\n🎉 Admin user is ready!');
    console.log('🌐 You can now login at: http://localhost:3000');
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Password: ${password}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createAdminUser();