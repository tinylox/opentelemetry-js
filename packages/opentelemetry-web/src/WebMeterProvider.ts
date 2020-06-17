/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { MeterProvider, MeterConfig } from '@opentelemetry/metrics';
import { BaseMetricPlugin } from '@opentelemetry/core/build/src/platform/browser';

export interface WebMeterConfig extends MeterConfig {
  /**
   * plugins to be used with tracer, they will be enabled automatically
   */
  plugins?: BaseMetricPlugin<unknown>[];
}

export class WebMeterProvider extends MeterProvider {
  constructor(config: WebMeterConfig = {}) {
    if (typeof config.plugins === 'undefined') {
      config.plugins = [];
    }
    super(config);

    for (const plugin of config.plugins) {
      plugin.enable([], this);
    }
  }
}
