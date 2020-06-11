import { MeterProvider, MeterConfig } from '@opentelemetry/metrics';

export class WebMeterProvider extends MeterProvider {
    constructor(config: MeterConfig = {}){
        super(config);
    }
}