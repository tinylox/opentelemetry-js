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
import {
  MetricPlugin,
  MetricPluginConfig,
  MeterProvider,
  Meter,
} from '@opentelemetry/api';

export abstract class BaseAbstractMetricPlugin<T> implements MetricPlugin<T> {
  protected _moduleExports!: T;
  protected _meter!: Meter;
  protected _config!: MetricPluginConfig;

  constructor(
    protected readonly _meterName: string,
    protected readonly _meterVersion?: string
  ) {}

  abstract enable(
    moduleExports: T,
    meterProvider: MeterProvider,
    config?: MetricPluginConfig
  ): T;

  disable(): void {
    this.unpatch();
  }

  protected abstract patch(): T;
  protected abstract unpatch(): void;
}
