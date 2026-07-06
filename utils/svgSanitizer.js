/**
 * SVG Sanitizer
 * 
 * Sanitizes SVG files to remove potentially dangerous content like:
 * - JavaScript code
 * - Event handlers
 * - External references
 * - Embedded scripts
 */

/**
 * Sanitize SVG buffer
 * @param {Buffer} buffer - SVG file buffer
 * @returns {Buffer} Sanitized SVG buffer
 */
function sanitizeSVG(buffer) {
  try {
    let svgContent = buffer.toString('utf8');
    
    // Remove script tags and their content
    svgContent = svgContent.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Remove event handlers (onclick, onload, onerror, etc.)
    svgContent = svgContent.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
    svgContent = svgContent.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');
    
    // Remove javascript: protocol
    svgContent = svgContent.replace(/javascript:/gi, '');
    
    // Remove data: URIs that might contain scripts
    svgContent = svgContent.replace(/data:text\/html[^"']*/gi, '');
    
    // Remove foreign objects (can embed HTML/scripts)
    svgContent = svgContent.replace(/<foreignObject\b[^<]*(?:(?!<\/foreignObject>)<[^<]*)*<\/foreignObject>/gi, '');
    
    // Remove use elements with external references
    svgContent = svgContent.replace(/<use[^>]*xlink:href\s*=\s*["']https?:\/\/[^"']*["'][^>]*>/gi, '');
    
    // Remove style tags with potential CSS injection
    svgContent = svgContent.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    
    // Remove XML processing instructions that might be dangerous
    svgContent = svgContent.replace(/<\?xml[^?]*\?>/gi, '<?xml version="1.0" encoding="UTF-8"?>');
    
    // Remove DOCTYPE declarations
    svgContent = svgContent.replace(/<!DOCTYPE[^>]*>/gi, '');
    
    // Remove CDATA sections (can hide scripts)
    svgContent = svgContent.replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, '');
    
    // Ensure SVG has proper namespace
    if (!svgContent.includes('xmlns="http://www.w3.org/2000/svg"')) {
      svgContent = svgContent.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    
    return Buffer.from(svgContent, 'utf8');
  } catch (error) {
    console.error('[SVG Sanitizer] Error sanitizing SVG:', error);
    throw new Error('Failed to sanitize SVG file');
  }
}

/**
 * Validate SVG structure
 * @param {Buffer} buffer - SVG file buffer
 * @returns {boolean} True if valid SVG
 */
function isValidSVG(buffer) {
  try {
    const content = buffer.toString('utf8');
    
    // Check if it starts with XML declaration or SVG tag
    const hasValidStart = content.trim().startsWith('<?xml') || 
                         content.trim().startsWith('<svg');
    
    // Check if it contains SVG tag
    const hasSVGTag = /<svg[\s>]/i.test(content);
    
    // Check if it has closing SVG tag
    const hasClosingSVGTag = /<\/svg>/i.test(content);
    
    return hasValidStart && hasSVGTag && hasClosingSVGTag;
  } catch (error) {
    return false;
  }
}

module.exports = {
  sanitizeSVG,
  isValidSVG
};
