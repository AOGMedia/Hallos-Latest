const XLSX = require('xlsx');
const path = require('path');
const sequelize = require('../config/db');

// Import models with associations
require('../models/courseIndex');
const Department = require('../models/Department');
const Course = require('../models/Course');

/**
 * Course Import Script
 * 
 * Reads Excel file with multiple sheets and imports course data:
 * - Each sheet becomes a department
 * - Each row becomes a course
 * - Fixed pricing: USD $35, NGN ₦50,000
 * - Idempotent: safe to re-run
 */

class CourseImporter {
  constructor() {
    this.stats = {
      departmentsCreated: 0,
      departmentsSkipped: 0,
      coursesCreated: 0,
      coursesUpdated: 0,
      coursesSkipped: 0,
      errors: []
    };
  }

  /**
   * Main import function
   */
  async importFromExcel(filePath) {
    try {
      console.log('🚀 Starting course import from Excel file...\n');
      console.log(`📁 File: ${filePath}\n`);

      // Check if file exists
      if (!require('fs').existsSync(filePath)) {
        throw new Error(`Excel file not found: ${filePath}`);
      }

      // Read Excel file
      console.log('📖 Reading Excel file...');
      const workbook = XLSX.readFile(filePath);
      console.log(`✅ Found ${workbook.SheetNames.length} sheets: ${workbook.SheetNames.join(', ')}\n`);

      // Process each sheet
      for (const sheetName of workbook.SheetNames) {
        await this.processSheet(workbook, sheetName);
      }

      // Print final statistics
      this.printStatistics();

      console.log('\n🎉 Course import completed successfully!');
      return this.stats;

    } catch (error) {
      console.error('❌ Import failed:', error.message);
      console.error('\nFull error:', error);
      throw error;
    }
  }

  /**
   * Process a single sheet (department)
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

      // Get or create department
      const department = await this.getOrCreateDepartment(sheetName);

      // Process header row to map columns
      const headers = jsonData[0];
      const columnMapping = this.mapColumns(headers);
      
      console.log(`📊 Found ${jsonData.length - 1} course rows`);
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
          await this.processCourseRow(row, columnMapping, department.id);
          processedCount++;
        } catch (error) {
          this.stats.errors.push({
            sheet: sheetName,
            row: i + 1,
            error: error.message,
            data: row
          });
          console.error(`❌ Error processing row ${i + 1}:`, error.message);
        }
      }

      console.log(`✅ Processed ${processedCount} courses from "${sheetName}"\n`);

    } catch (error) {
      console.error(`❌ Error processing sheet "${sheetName}":`, error.message);
      this.stats.errors.push({
        sheet: sheetName,
        error: error.message
      });
    }
  }

  /**
   * Get or create department from sheet name
   */
  async getOrCreateDepartment(sheetName) {
    try {
      // Clean up sheet name for department
      const departmentName = sheetName.trim();
      const slug = this.generateSlug(departmentName);

      // Check if department exists
      let department = await Department.findOne({
        where: { slug }
      });

      if (department) {
        console.log(`📁 Using existing department: "${departmentName}"`);
        this.stats.departmentsSkipped++;
        return department;
      }

      // Create new department
      department = await Department.create({
        name: departmentName,
        slug: slug,
        description: `Courses in ${departmentName}`
      });

      console.log(`✨ Created new department: "${departmentName}" (${slug})`);
      this.stats.departmentsCreated++;
      return department;

    } catch (error) {
      console.error(`❌ Error creating department "${sheetName}":`, error.message);
      throw error;
    }
  }

  /**
   * Map Excel columns to course fields
   */
  mapColumns(headers) {
    const mapping = {};
    
    headers.forEach((header, index) => {
      const cleanHeader = header.toString().toLowerCase().trim();
      
      // Map common column names to course fields
      if (cleanHeader.includes('course name') || cleanHeader.includes('name')) {
        mapping.name = index;
      } else if (cleanHeader.includes('course link') || cleanHeader.includes('link') || cleanHeader.includes('url')) {
        mapping.link = index;
      } else if (cleanHeader.includes('course content') || cleanHeader.includes('content') || cleanHeader.includes('description')) {
        mapping.content = index;
      } else if (cleanHeader.includes('curriculum')) {
        mapping.curriculum = index;
      } else if (cleanHeader.includes('duration')) {
        mapping.duration = index;
      } else if (cleanHeader.includes('image') || cleanHeader.includes('thumbnail')) {
        mapping.imageUrl = index;
      }
    });

    return mapping;
  }

  /**
   * Process a single course row
   */
  async processCourseRow(row, columnMapping, departmentId) {
    // Extract course data from row
    const courseData = {
      departmentId,
      name: this.getCellValue(row, columnMapping.name),
      link: this.getCellValue(row, columnMapping.link),
      content: this.getCellValue(row, columnMapping.content),
      curriculum: this.getCellValue(row, columnMapping.curriculum),
      duration: this.getCellValue(row, columnMapping.duration),
      imageUrl: this.getCellValue(row, columnMapping.imageUrl),
      priceUsd: 35.00,  // Fixed price
      priceNgn: 50000.00,  // Fixed price
      isActive: true
    };

    // Validate required fields
    if (!courseData.name || !courseData.link) {
      throw new Error('Missing required fields: name and link are required');
    }

    // Validate URL
    if (!this.isValidUrl(courseData.link)) {
      throw new Error(`Invalid URL: ${courseData.link}`);
    }

    // Check if course already exists (by name and department)
    const existingCourse = await Course.findOne({
      where: {
        name: courseData.name,
        departmentId: departmentId
      }
    });

    if (existingCourse) {
      // Update existing course
      await existingCourse.update(courseData);
      this.stats.coursesUpdated++;
      console.log(`🔄 Updated course: "${courseData.name}"`);
    } else {
      // Create new course
      await Course.create(courseData);
      this.stats.coursesCreated++;
      console.log(`✨ Created course: "${courseData.name}"`);
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

  generateSlug(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .trim();
  }

  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  printStatistics() {
    console.log('\n📊 Import Statistics:');
    console.log('='.repeat(50));
    console.log(`📁 Departments created: ${this.stats.departmentsCreated}`);
    console.log(`📁 Departments skipped: ${this.stats.departmentsSkipped}`);
    console.log(`📚 Courses created: ${this.stats.coursesCreated}`);
    console.log(`🔄 Courses updated: ${this.stats.coursesUpdated}`);
    console.log(`⚠️  Courses skipped: ${this.stats.coursesSkipped}`);
    console.log(`❌ Errors: ${this.stats.errors.length}`);

    if (this.stats.errors.length > 0) {
      console.log('\n❌ Error Details:');
      this.stats.errors.forEach((error, index) => {
        console.log(`${index + 1}. Sheet: ${error.sheet}, Row: ${error.row || 'N/A'}`);
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
    const filePath = process.argv[2] || path.join(__dirname, '../data/Categorised Course List.xlsx');
    
    // Create importer and run import
    const importer = new CourseImporter();
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

module.exports = CourseImporter;