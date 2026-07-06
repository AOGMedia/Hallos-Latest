const XLSX = require('xlsx');
const path = require('path');
const sequelize = require('../config/db');

// Import models
require('../models/ugcIndex');
const Company = require('../models/Company');

/**
 * Company Import Script
 * 
 * Reads Excel file and imports Nigerian brands/companies:
 * - Company Name
 * - Industry
 * - Website
 * - Contact Name
 * - Contact Email
 * - Idempotent: safe to re-run
 */

class CompanyImporter {
  constructor() {
    this.stats = {
      companiesCreated: 0,
      companiesUpdated: 0,
      companiesSkipped: 0,
      errors: []
    };
  }

  /**
   * Main import function
   */
  async importFromExcel(filePath) {
    try {
      console.log('🚀 Starting company import from Excel file...\n');
      console.log(`📁 File: ${filePath}\n`);

      // Check if file exists
      if (!require('fs').existsSync(filePath)) {
        throw new Error(`Excel file not found: ${filePath}`);
      }

      // Read Excel file
      console.log('📖 Reading Excel file...');
      const workbook = XLSX.readFile(filePath);
      console.log(`✅ Found ${workbook.SheetNames.length} sheet(s): ${workbook.SheetNames.join(', ')}\n`);

      // Process first sheet (assuming companies are in first sheet)
      const sheetName = workbook.SheetNames[0];
      await this.processSheet(workbook, sheetName);

      // Print final statistics
      this.printStatistics();

      console.log('\n🎉 Company import completed successfully!');
      return this.stats;

    } catch (error) {
      console.error('❌ Import failed:', error.message);
      console.error('\nFull error:', error);
      throw error;
    }
  }

  /**
   * Process the sheet
   */
  async processSheet(workbook, sheetName) {
    try {
      console.log(`📋 Processing sheet: "${sheetName}"`);

      // Convert sheet to JSON
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1,
        defval: '' // Default value for empty cells
      });

      if (jsonData.length === 0) {
        console.log(`⚠️  Sheet "${sheetName}" is empty, skipping...\n`);
        return;
      }

      // Process header row to map columns
      const headers = jsonData[0];
      const columnMapping = this.mapColumns(headers);
      
      console.log(`📊 Found ${jsonData.length - 1} company rows`);
      console.log(`🗂️  Column mapping:`, columnMapping);

      // Process data rows (skip header)
      let processedCount = 0;
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        
        // Skip empty rows
        if (this.isEmptyRow(row)) {
          continue;
        }

        try {
          await this.processCompanyRow(row, columnMapping);
          processedCount++;
        } catch (error) {
          this.stats.errors.push({
            row: i + 1,
            error: error.message,
            data: row
          });
          console.error(`❌ Error processing row ${i + 1}:`, error.message);
        }
      }

      console.log(`✅ Processed ${processedCount} companies from "${sheetName}"\n`);

    } catch (error) {
      console.error(`❌ Error processing sheet "${sheetName}":`, error.message);
      this.stats.errors.push({
        sheet: sheetName,
        error: error.message
      });
    }
  }

  /**
   * Map Excel columns to company fields
   */
  mapColumns(headers) {
    const mapping = {};
    
    headers.forEach((header, index) => {
      const cleanHeader = header.toString().toLowerCase().trim();
      
      // Map column names to company fields
      if (cleanHeader.includes('company') && cleanHeader.includes('name')) {
        mapping.companyName = index;
      } else if (cleanHeader.includes('industry')) {
        mapping.industry = index;
      } else if (cleanHeader.includes('website')) {
        mapping.website = index;
      } else if (cleanHeader.includes('contact') && cleanHeader.includes('name')) {
        mapping.contactName = index;
      } else if (cleanHeader.includes('contact') && cleanHeader.includes('email')) {
        mapping.contactEmail = index;
      } else if (cleanHeader.includes('email') && !cleanHeader.includes('contact')) {
        mapping.contactEmail = index;
      }
    });

    return mapping;
  }

  /**
   * Process a single company row
   */
  async processCompanyRow(row, columnMapping) {
    // Extract company data from row
    const companyData = {
      companyName: this.getCellValue(row, columnMapping.companyName),
      industry: this.getCellValue(row, columnMapping.industry),
      website: this.getCellValue(row, columnMapping.website),
      contactName: this.getCellValue(row, columnMapping.contactName),
      contactEmail: this.getCellValue(row, columnMapping.contactEmail)
    };

    // Validate required fields
    if (!companyData.companyName || !companyData.industry || !companyData.contactEmail) {
      throw new Error('Missing required fields: company name, industry, and contact email are required');
    }

    // Validate email
    if (!this.isValidEmail(companyData.contactEmail)) {
      throw new Error(`Invalid email: ${companyData.contactEmail}`);
    }

    // Clean up website URL
    if (companyData.website && !companyData.website.startsWith('http')) {
      companyData.website = 'https://' + companyData.website;
    }

    // Check if company already exists (by name)
    const existingCompany = await Company.findOne({
      where: {
        companyName: companyData.companyName
      }
    });

    if (existingCompany) {
      // Update existing company
      await existingCompany.update(companyData);
      this.stats.companiesUpdated++;
      console.log(`🔄 Updated company: "${companyData.companyName}"`);
    } else {
      // Create new company
      await Company.create(companyData);
      this.stats.companiesCreated++;
      console.log(`✨ Created company: "${companyData.companyName}"`);
    }
  }

  /**
   * Helper methods
   */
  getCellValue(row, columnIndex) {
    if (columnIndex === undefined || columnIndex === null) {
      return null;
    }
    const value = row[columnIndex];
    return value ? value.toString().trim() : null;
  }

  isEmptyRow(row) {
    return !row || row.every(cell => !cell || cell.toString().trim() === '');
  }

  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  printStatistics() {
    console.log('\n📊 Import Statistics:');
    console.log('='.repeat(50));
    console.log(`✨ Companies created: ${this.stats.companiesCreated}`);
    console.log(`🔄 Companies updated: ${this.stats.companiesUpdated}`);
    console.log(`⚠️  Companies skipped: ${this.stats.companiesSkipped}`);
    console.log(`❌ Errors: ${this.stats.errors.length}`);

    if (this.stats.errors.length > 0) {
      console.log('\n❌ Error Details:');
      this.stats.errors.forEach((error, index) => {
        console.log(`${index + 1}. Row: ${error.row || 'N/A'}`);
        console.log(`   Error: ${error.error}`);
        if (error.data) {
          console.log(`   Data: ${JSON.stringify(error.data).substring(0, 100)}...`);
        }
      });
    }
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    // Connect to database
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');

    // Sync models (ensure tables exist)
    await sequelize.sync();
    console.log('✅ Database models synchronized\n');

    // Get Excel file path
    const filePath = process.argv[2] || path.join(__dirname, '../data/Hallos Copy of 500+ Nigerian Brands for UGC Creators.xlsx');
    
    // Create importer and run import
    const importer = new CompanyImporter();
    const stats = await importer.importFromExcel(filePath);

    // Close database connection
    await sequelize.close();
    console.log('\n✅ Database connection closed');

    // Exit with appropriate code
    process.exit(stats.errors.length > 0 ? 1 : 0);

  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    console.error('\nFull error:', error);
    
    try {
      await sequelize.close();
    } catch (closeError) {
      console.error('Error closing database:', closeError.message);
    }
    
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = CompanyImporter;
