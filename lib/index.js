const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse/sync');
const sgMail = require('@sendgrid/mail');

async function main() {
  const args = process.argv.slice(2);
  const folder = args.find(arg => !arg.startsWith('--'));
  const isDev = args.includes('--dev');

  if (!folder) {
    console.error('❌ Please specify a folder path.');
    process.exit(1);
  }

  const folderPath = path.resolve(folder);
  const csvPath = path.join(folderPath, 'data.csv');
  const htmlPath = path.join(folderPath, 'template.html');
  const jsonPath = path.join(folderPath, 'data.json');
  const statusPath = path.join(folderPath, 'status.json');

  // Load data
  const [csvData, htmlTemplate, globalData] = await Promise.all([
    fs.readFile(csvPath, 'utf8'),
    fs.readFile(htmlPath, 'utf8'),
    fs.readJson(jsonPath)
  ]);

  // Set SendGrid API key
  if (!globalData.sendgrid_key) {
    console.error('❌ SendGrid API key not found in data.json.');
    process.exit(1);
  }
  sgMail.setApiKey(globalData.sendgrid_key);

  // Parse CSV
  const records = parse(csvData, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  // Load or initialize status
  const status = await fs.readJson(statusPath).catch(() => ({}));

  const sendEmail = async (data) => {
    const finalData = { ...globalData, ...data };
    const compiledHtml = htmlTemplate.replace(/{(.*?)}/g, (_, key) => finalData[key] || '');

    const msg = {
      to: finalData.email,
      from: globalData.from_email || 'no-reply@example.com', // Provide default fallback
      subject: globalData.subject || 'No Subject',
      html: compiledHtml
    };

    try {
      const response = await sgMail.send(msg);
      status[finalData.email] = {
        status: 'sent',
        timestamp: new Date().toISOString(),
        response: response[0].statusCode
      };
      console.log(`✅ Sent email to ${finalData.email}`);
    } catch (err) {
      status[finalData.email] = {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: err.message
      };
      console.error(`❌ Failed to send email to ${finalData.email}: ${err.message}`);
    }
  };

  if (isDev) {
    if (!globalData.dev_email) {
      console.error('❌ dev_email not specified in data.json');
      process.exit(1);
    }

    const devData = {
      email: globalData.dev_email,
      ...records[0]
    };
    await sendEmail(devData);
  } else {
    for (const record of records) {
      if (!record.email) {
        console.warn('⚠️ Skipping record without email:', record);
        continue;
      }

      if (status[record.email]?.status === 'sent') {
        console.log(`ℹ️ Email already sent to ${record.email}, skipping.`);
        continue;
      }

      await sendEmail(record);
    }
  }

  await fs.writeJson(statusPath, status, { spaces: 2 });
  console.log('📄 Updated status.json');
}

main().catch(err => {
  console.error('💥 Unexpected error:', err);
  process.exit(1);
});
