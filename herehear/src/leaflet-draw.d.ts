// TypeScript declaration for Leaflet.Draw plugin
import * as L from 'leaflet';

declare module 'leaflet' {
    namespace Control {
        class Draw extends L.Control {
            constructor(options?: any);
        }
    }
}
