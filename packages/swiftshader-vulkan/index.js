// SwiftShader Vulkan ICD for the current platform, or null when this package has no build for it.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname( fileURLToPath( import.meta.url ) );

/** Absolute path of `vk_swiftshader_icd.json` for `process.platform`/`process.arch`, or null. */
export function icdPath() {

	const path = join( root, `${ process.platform }-${ process.arch }`, 'vk_swiftshader_icd.json' );
	return existsSync( path ) ? path : null;

}

/** Environment variables that make the Vulkan loader use SwiftShader only (`{}` when unavailable). */
export function vulkanEnvironment() {

	const icd = icdPath();
	return icd ? { VK_DRIVER_FILES: icd, VK_ICD_FILENAMES: icd } : {};

}
