// Format-adapter barrel. Importing this module ensures all adapters are
// registered in the registry. Add new adapters here as they are implemented.
//
// The side-effect import of each adapter causes it to call registerAdapter()
// at module-evaluation time, before any parse() call can happen.

import './epub/epub-adapter.js';

// Future adapters:
// import './pdf/pdf-adapter.js';
// import './mobi/mobi-adapter.js';
