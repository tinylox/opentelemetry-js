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

import * as assert from 'assert';
import {
  Meter,
  Metric,
  CounterMetric,
  MetricKind,
  Sum,
  MeterProvider,
  ValueRecorderMetric,
  ValueObserverMetric,
  MetricRecord,
  Aggregator,
  MetricDescriptor,
  UpDownCounterMetric,
  Distribution,
  MinMaxLastSumCountAggregator,
} from '../src';
import * as api from '@opentelemetry/api';
import { NoopLogger, hrTime, hrTimeToNanoseconds } from '@opentelemetry/core';
import { BatchObserverResult } from '../src/BatchObserverResult';
import { SumAggregator } from '../src/export/aggregators';
import { Resource } from '@opentelemetry/resources';
import { hashLabels } from '../src/Utils';
import { Batcher } from '../src/export/Batcher';

describe('Meter', () => {
  let meter: Meter;
  const keya = 'keya';
  const keyb = 'keyb';
  const labels: api.Labels = { [keyb]: 'value2', [keya]: 'value1' };

  beforeEach(() => {
    meter = new MeterProvider({
      logger: new NoopLogger(),
    }).getMeter('test-meter');
  });

  describe('#counter', () => {
    const performanceTimeOrigin = hrTime();

    it('should create a counter', () => {
      const counter = meter.createCounter('name');
      assert.ok(counter instanceof Metric);
    });

    it('should create a counter with options', () => {
      const counter = meter.createCounter('name', {
        description: 'desc',
        unit: '1',
        disabled: false,
      });
      assert.ok(counter instanceof Metric);
    });

    it('should be able to call add() directly on counter', async () => {
      const counter = meter.createCounter('name') as CounterMetric;
      counter.add(10, labels);
      await meter.collect();
      const [record1] = meter.getBatcher().checkPointSet();

      assert.strictEqual(record1.aggregator.toPoint().value, 10);
      const lastTimestamp = record1.aggregator.toPoint().timestamp;
      assert.ok(
        hrTimeToNanoseconds(lastTimestamp) >
          hrTimeToNanoseconds(performanceTimeOrigin)
      );
      counter.add(10, labels);
      assert.strictEqual(record1.aggregator.toPoint().value, 20);

      assert.ok(
        hrTimeToNanoseconds(record1.aggregator.toPoint().timestamp) >
          hrTimeToNanoseconds(lastTimestamp)
      );
    });

    it('should be able to call add with no labels', async () => {
      const counter = meter.createCounter('name', {
        description: 'desc',
        unit: '1',
        disabled: false,
      });
      counter.add(1);
      await meter.collect();
      const [record1] = meter.getBatcher().checkPointSet();
      assert.strictEqual(record1.aggregator.toPoint().value, 1);
    });

    it('should pipe through resource', async () => {
      const counter = meter.createCounter('name') as CounterMetric;
      assert.ok(counter.resource instanceof Resource);

      counter.add(1, { foo: 'bar' });

      const [record] = await counter.getMetricRecord();
      assert.ok(record.resource instanceof Resource);
    });

    it('should pipe through instrumentation library', async () => {
      const counter = meter.createCounter('name') as CounterMetric;
      assert.ok(counter.instrumentationLibrary);

      counter.add(1, { foo: 'bar' });

      const [record] = await counter.getMetricRecord();
      const { name, version } = record.instrumentationLibrary;
      assert.strictEqual(name, 'test-meter');
      assert.strictEqual(version, '*');
    });

    describe('.bind()', () => {
      it('should create a counter instrument', async () => {
        const counter = meter.createCounter('name') as CounterMetric;
        const boundCounter = counter.bind(labels);
        boundCounter.add(10);
        await meter.collect();
        const [record1] = meter.getBatcher().checkPointSet();

        assert.strictEqual(record1.aggregator.toPoint().value, 10);
        boundCounter.add(10);
        assert.strictEqual(record1.aggregator.toPoint().value, 20);
      });

      it('should return the aggregator', () => {
        const counter = meter.createCounter('name') as CounterMetric;
        const boundCounter = counter.bind(labels);
        boundCounter.add(20);
        assert.ok(boundCounter.getAggregator() instanceof SumAggregator);
        assert.strictEqual(boundCounter.getLabels(), labels);
      });

      it('should add positive values only', async () => {
        const counter = meter.createCounter('name') as CounterMetric;
        const boundCounter = counter.bind(labels);
        boundCounter.add(10);
        assert.strictEqual(meter.getBatcher().checkPointSet().length, 0);
        await meter.collect();
        const [record1] = meter.getBatcher().checkPointSet();

        assert.strictEqual(record1.aggregator.toPoint().value, 10);
        boundCounter.add(-100);
        assert.strictEqual(record1.aggregator.toPoint().value, 10);
      });

      it('should not add the instrument data when disabled', async () => {
        const counter = meter.createCounter('name', {
          disabled: true,
        }) as CounterMetric;
        const boundCounter = counter.bind(labels);
        boundCounter.add(10);
        await meter.collect();
        const [record1] = meter.getBatcher().checkPointSet();
        assert.strictEqual(record1.aggregator.toPoint().value, 0);
      });

      it('should return same instrument on same label values', async () => {
        const counter = meter.createCounter('name') as CounterMetric;
        const boundCounter = counter.bind(labels);
        boundCounter.add(10);
        const boundCounter1 = counter.bind(labels);
        boundCounter1.add(10);
        await meter.collect();
        const [record1] = meter.getBatcher().checkPointSet();

        assert.strictEqual(record1.aggregator.toPoint().value, 20);
        assert.strictEqual(boundCounter, boundCounter1);
      });
    });

    describe('.unbind()', () => {
      it('should remove a counter instrument', () => {
        const counter = meter.createCounter('name') as CounterMetric;
        const boundCounter = counter.bind(labels);
        assert.strictEqual(counter['_instruments'].size, 1);
        counter.unbind(labels);
        assert.strictEqual(counter['_instruments'].size, 0);
        const boundCounter1 = counter.bind(labels);
        assert.strictEqual(counter['_instruments'].size, 1);
        assert.notStrictEqual(boundCounter, boundCounter1);
      });

      it('should not fail when removing non existing instrument', () => {
        const counter = meter.createCounter('name');
        counter.unbind({});
      });

      it('should clear all instruments', () => {
        const counter = meter.createCounter('name') as CounterMetric;
        counter.bind(labels);
        assert.strictEqual(counter['_instruments'].size, 1);
        counter.clear();
        assert.strictEqual(counter['_instruments'].size, 0);
      });
    });

    describe('.registerMetric()', () => {
      it('skip already registered Metric', async () => {
        const counter1 = meter.createCounter('name1') as CounterMetric;
        counter1.bind(labels).add(10);

        // should skip below metric
        const counter2 = meter.createCounter('name1', {
          valueType: api.ValueType.INT,
        }) as CounterMetric;
        counter2.bind(labels).add(500);

        await meter.collect();
        const record = meter.getBatcher().checkPointSet();

        assert.strictEqual(record.length, 1);
        assert.deepStrictEqual(record[0].descriptor, {
          description: '',
          metricKind: MetricKind.COUNTER,
          name: 'name1',
          unit: '1',
          valueType: api.ValueType.DOUBLE,
        });
        assert.strictEqual(record[0].aggregator.toPoint().value, 10);
      });
    });

    describe('names', () => {
      it('should create counter with valid names', () => {
        const counter1 = meter.createCounter('name1');
        const counter2 = meter.createCounter(
          'Name_with-all.valid_CharacterClasses'
        );
        assert.ok(counter1 instanceof CounterMetric);
        assert.ok(counter2 instanceof CounterMetric);
      });

      it('should return no op metric if name is an empty string', () => {
        const counter = meter.createCounter('');
        assert.ok(counter instanceof api.NoopMetric);
      });

      it('should return no op metric if name does not start with a letter', () => {
        const counter1 = meter.createCounter('1name');
        const counter_ = meter.createCounter('_name');
        assert.ok(counter1 instanceof api.NoopMetric);
        assert.ok(counter_ instanceof api.NoopMetric);
      });

      it('should return no op metric if name is an empty string contain only letters, numbers, ".", "_", and "-"', () => {
        const counter = meter.createCounter('name with invalid characters^&*(');
        assert.ok(counter instanceof api.NoopMetric);
      });
    });
  });

  describe('#UpDownCounter', () => {
    const performanceTimeOrigin = hrTime();

    it('should create a UpDownCounter', () => {
      const upDownCounter = meter.createUpDownCounter('name');
      assert.ok(upDownCounter instanceof Metric);
    });

    it('should create a UpDownCounter with options', () => {
      const upDownCounter = meter.createUpDownCounter('name', {
        description: 'desc',
        unit: '1',
        disabled: false,
      });
      assert.ok(upDownCounter instanceof Metric);
    });

    it('should be able to call add() directly on UpDownCounter', async () => {
      const upDownCounter = meter.createUpDownCounter('name');
      upDownCounter.add(10, labels);
      await meter.collect();
      const [record1] = meter.getBatcher().checkPointSet();

      assert.strictEqual(record1.aggregator.toPoint().value, 10);
      const lastTimestamp = record1.aggregator.toPoint().timestamp;
      assert.ok(
        hrTimeToNanoseconds(lastTimestamp) >
          hrTimeToNanoseconds(performanceTimeOrigin)
      );
      upDownCounter.add(10, labels);
      assert.strictEqual(record1.aggregator.toPoint().value, 20);

      assert.ok(
        hrTimeToNanoseconds(record1.aggregator.toPoint().timestamp) >
          hrTimeToNanoseconds(lastTimestamp)
      );
    });

    it('should be able to call add with no labels', async () => {
      const upDownCounter = meter.createUpDownCounter('name', {
        description: 'desc',
        unit: '1',
        disabled: false,
      });
      upDownCounter.add(1);
      await meter.collect();
      const [record1] = meter.getBatcher().checkPointSet();
      assert.strictEqual(record1.aggregator.toPoint().value, 1);
    });

    it('should pipe through resource', async () => {
      const upDownCounter = meter.createUpDownCounter(
        'name'
      ) as UpDownCounterMetric;
      assert.ok(upDownCounter.resource instanceof Resource);

      upDownCounter.add(1, { foo: 'bar' });

      const [record] = await upDownCounter.getMetricRecord();
      assert.ok(record.resource instanceof Resource);
    });

    describe('.bind()', () => {
      it('should create a UpDownCounter instrument', async () => {
        const upDownCounter = meter.createUpDownCounter('name');
        const boundCounter = upDownCounter.bind(labels);
        boundCounter.add(10);
        await meter.collect();
        const [record1] = meter.getBatcher().checkPointSet();

        assert.strictEqual(record1.aggregator.toPoint().value, 10);
        boundCounter.add(-200);
        assert.strictEqual(record1.aggregator.toPoint().value, -190);
      });

      it('should return the aggregator', () => {
        const upDownCounter = meter.createUpDownCounter(
          'name'
        ) as UpDownCounterMetric;
        const boundCounter = upDownCounter.bind(labels);
        boundCounter.add(20);
        assert.ok(boundCounter.getAggregator() instanceof SumAggregator);
        assert.strictEqual(boundCounter.getLabels(), labels);
      });

      it('should not add the instrument data when disabled', async () => {
        const upDownCounter = meter.createUpDownCounter('name', {
          disabled: true,
        });
        const boundCounter = upDownCounter.bind(labels);
        boundCounter.add(10);
        await meter.collect();
        const [record1] = meter.getBatcher().checkPointSet();
        assert.strictEqual(record1.aggregator.toPoint().value, 0);
      });

      it('should return same instrument on same label values', async () => {
        const upDownCounter = meter.createUpDownCounter('name');
        const boundCounter = upDownCounter.bind(labels);
        boundCounter.add(10);
        const boundCounter1 = upDownCounter.bind(labels);
        boundCounter1.add(10);
        await meter.collect();
        const [record1] = meter.getBatcher().checkPointSet();

        assert.strictEqual(record1.aggregator.toPoint().value, 20);
        assert.strictEqual(boundCounter, boundCounter1);
      });
    });

    describe('.unbind()', () => {
      it('should remove a UpDownCounter instrument', () => {
        const upDownCounter = meter.createUpDownCounter(
          'name'
        ) as UpDownCounterMetric;
        const boundCounter = upDownCounter.bind(labels);
        assert.strictEqual(upDownCounter['_instruments'].size, 1);
        upDownCounter.unbind(labels);
        assert.strictEqual(upDownCounter['_instruments'].size, 0);
        const boundCounter1 = upDownCounter.bind(labels);
        assert.strictEqual(upDownCounter['_instruments'].size, 1);
        assert.notStrictEqual(boundCounter, boundCounter1);
      });

      it('should not fail when removing non existing instrument', () => {
        const upDownCounter = meter.createUpDownCounter('name');
        upDownCounter.unbind({});
      });

      it('should clear all instruments', () => {
        const upDownCounter = meter.createUpDownCounter(
          'name'
        ) as CounterMetric;
        upDownCounter.bind(labels);
        assert.strictEqual(upDownCounter['_instruments'].size, 1);
        upDownCounter.clear();
        assert.strictEqual(upDownCounter['_instruments'].size, 0);
      });
    });

    describe('.registerMetric()', () => {
      it('skip already registered Metric', async () => {
        const counter1 = meter.createCounter('name1') as CounterMetric;
        counter1.bind(labels).add(10);

        // should skip below metric
        const counter2 = meter.createCounter('name1', {
          valueType: api.ValueType.INT,
        }) as CounterMetric;
        counter2.bind(labels).add(500);

        await meter.collect();
        const record = meter.getBatcher().checkPointSet();

        assert.strictEqual(record.length, 1);
        assert.deepStrictEqual(record[0].descriptor, {
          description: '',
          metricKind: MetricKind.COUNTER,
          name: 'name1',
          unit: '1',
          valueType: api.ValueType.DOUBLE,
        });
        assert.strictEqual(record[0].aggregator.toPoint().value, 10);
      });
    });

    describe('names', () => {
      it('should create counter with valid names', () => {
        const counter1 = meter.createCounter('name1');
        const counter2 = meter.createCounter(
          'Name_with-all.valid_CharacterClasses'
        );
        assert.ok(counter1 instanceof CounterMetric);
        assert.ok(counter2 instanceof CounterMetric);
      });

      it('should return no op metric if name is an empty string', () => {
        const counter = meter.createCounter('');
        assert.ok(counter instanceof api.NoopMetric);
      });

      it('should return no op metric if name does not start with a letter', () => {
        const counter1 = meter.createCounter('1name');
        const counter_ = meter.createCounter('_name');
        assert.ok(counter1 instanceof api.NoopMetric);
        assert.ok(counter_ instanceof api.NoopMetric);
      });

      it('should return no op metric if name is an empty string contain only letters, numbers, ".", "_", and "-"', () => {
        const counter = meter.createCounter('name with invalid characters^&*(');
        assert.ok(counter instanceof api.NoopMetric);
      });
    });
  });

  describe('#ValueRecorder', () => {
    it('should create a valueRecorder', () => {
      const valueRecorder = meter.createValueRecorder('name');
      assert.ok(valueRecorder instanceof Metric);
    });

    it('should create a valueRecorder with options', () => {
      const valueRecorder = meter.createValueRecorder('name', {
        description: 'desc',
        unit: '1',
        disabled: false,
      });
      assert.ok(valueRecorder instanceof Metric);
    });

    it('should be absolute by default', () => {
      const valueRecorder = meter.createValueRecorder('name', {
        description: 'desc',
        unit: '1',
        disabled: false,
      });
      assert.strictEqual(
        (valueRecorder as ValueRecorderMetric)['_absolute'],
        true
      );
    });

    it('should be able to set absolute to false', () => {
      const valueRecorder = meter.createValueRecorder('name', {
        description: 'desc',
        unit: '1',
        disabled: false,
        absolute: false,
      });
      assert.strictEqual(
        (valueRecorder as ValueRecorderMetric)['_absolute'],
        false
      );
    });

    it('should pipe through resource', async () => {
      const valueRecorder = meter.createValueRecorder(
        'name'
      ) as ValueRecorderMetric;
      assert.ok(valueRecorder.resource instanceof Resource);

      valueRecorder.record(1, { foo: 'bar' });

      const [record] = await valueRecorder.getMetricRecord();
      assert.ok(record.resource instanceof Resource);
    });

    it('should pipe through instrumentation library', async () => {
      const valueRecorder = meter.createValueRecorder(
        'name'
      ) as ValueRecorderMetric;
      assert.ok(valueRecorder.instrumentationLibrary);

      valueRecorder.record(1, { foo: 'bar' });

      const [record] = await valueRecorder.getMetricRecord();
      const { name, version } = record.instrumentationLibrary;
      assert.strictEqual(name, 'test-meter');
      assert.strictEqual(version, '*');
    });

    describe('names', () => {
      it('should return no op metric if name is an empty string', () => {
        const valueRecorder = meter.createValueRecorder('');
        assert.ok(valueRecorder instanceof api.NoopMetric);
      });

      it('should return no op metric if name does not start with a letter', () => {
        const valueRecorder1 = meter.createValueRecorder('1name');
        const valueRecorder_ = meter.createValueRecorder('_name');
        assert.ok(valueRecorder1 instanceof api.NoopMetric);
        assert.ok(valueRecorder_ instanceof api.NoopMetric);
      });

      it('should return no op metric if name is an empty string contain only letters, numbers, ".", "_", and "-"', () => {
        const valueRecorder = meter.createValueRecorder(
          'name with invalid characters^&*('
        );
        assert.ok(valueRecorder instanceof api.NoopMetric);
      });
    });

    describe('.bind()', () => {
      const performanceTimeOrigin = hrTime();

      it('should create a valueRecorder instrument', () => {
        const valueRecorder = meter.createValueRecorder(
          'name'
        ) as ValueRecorderMetric;
        const boundValueRecorder = valueRecorder.bind(labels);
        assert.doesNotThrow(() => boundValueRecorder.record(10));
      });

      it('should not accept negative values by default', async () => {
        const valueRecorder = meter.createValueRecorder('name');
        const boundValueRecorder = valueRecorder.bind(labels);
        boundValueRecorder.record(-10);

        await meter.collect();
        const [record1] = meter.getBatcher().checkPointSet();
        assert.deepStrictEqual(
          record1.aggregator.toPoint().value as Distribution,
          {
            count: 0,
            last: 0,
            max: -Infinity,
            min: Infinity,
            sum: 0,
          }
        );
      });

      it('should not set the instrument data when disabled', async () => {
        const valueRecorder = meter.createValueRecorder('name', {
          disabled: true,
        }) as ValueRecorderMetric;
        const boundValueRecorder = valueRecorder.bind(labels);
        boundValueRecorder.record(10);

        await meter.collect();
        const [record1] = meter.getBatcher().checkPointSet();
        assert.deepStrictEqual(
          record1.aggregator.toPoint().value as Distribution,
          {
            count: 0,
            last: 0,
            max: -Infinity,
            min: Infinity,
            sum: 0,
          }
        );
      });

      it(
        'should accept negative (and positive) values when absolute is set' +
          ' to false',
        async () => {
          const valueRecorder = meter.createValueRecorder('name', {
            absolute: false,
          });
          const boundValueRecorder = valueRecorder.bind(labels);
          boundValueRecorder.record(-10);
          boundValueRecorder.record(50);

          await meter.collect();
          const [record1] = meter.getBatcher().checkPointSet();
          assert.deepStrictEqual(
            record1.aggregator.toPoint().value as Distribution,
            {
              count: 2,
              last: 50,
              max: 50,
              min: -10,
              sum: 40,
            }
          );
          assert.ok(
            hrTimeToNanoseconds(record1.aggregator.toPoint().timestamp) >
              hrTimeToNanoseconds(performanceTimeOrigin)
          );
        }
      );

      it('should return same instrument on same label values', async () => {
        const valueRecorder = meter.createValueRecorder(
          'name'
        ) as ValueRecorderMetric;
        const boundValueRecorder1 = valueRecorder.bind(labels);
        boundValueRecorder1.record(10);
        const boundValueRecorder2 = valueRecorder.bind(labels);
        boundValueRecorder2.record(100);
        await meter.collect();
        const [record1] = meter.getBatcher().checkPointSet();
        assert.deepStrictEqual(
          record1.aggregator.toPoint().value as Distribution,
          {
            count: 2,
            last: 100,
            max: 100,
            min: 10,
            sum: 110,
          }
        );
        assert.strictEqual(boundValueRecorder1, boundValueRecorder2);
      });
    });

    describe('.unbind()', () => {
      it('should remove the valueRecorder instrument', () => {
        const valueRecorder = meter.createValueRecorder(
          'name'
        ) as ValueRecorderMetric;
        const boundValueRecorder = valueRecorder.bind(labels);
        assert.strictEqual(valueRecorder['_instruments'].size, 1);
        valueRecorder.unbind(labels);
        assert.strictEqual(valueRecorder['_instruments'].size, 0);
        const boundValueRecorder2 = valueRecorder.bind(labels);
        assert.strictEqual(valueRecorder['_instruments'].size, 1);
        assert.notStrictEqual(boundValueRecorder, boundValueRecorder2);
      });

      it('should not fail when removing non existing instrument', () => {
        const valueRecorder = meter.createValueRecorder('name');
        valueRecorder.unbind({});
      });

      it('should clear all instruments', () => {
        const valueRecorder = meter.createValueRecorder(
          'name'
        ) as ValueRecorderMetric;
        valueRecorder.bind(labels);
        assert.strictEqual(valueRecorder['_instruments'].size, 1);
        valueRecorder.clear();
        assert.strictEqual(valueRecorder['_instruments'].size, 0);
      });
    });
  });

  describe('#valueObserver', () => {
    it('should create a value observer', () => {
      const valueObserver = meter.createValueObserver(
        'name'
      ) as ValueObserverMetric;
      assert.ok(valueObserver instanceof Metric);
    });

    it('should create observer with options', () => {
      const valueObserver = meter.createValueObserver('name', {
        description: 'desc',
        unit: '1',
        disabled: false,
      }) as ValueObserverMetric;
      assert.ok(valueObserver instanceof Metric);
    });

    it('should set callback and observe value ', async () => {
      const valueRecorder = meter.createValueObserver(
        'name',
        {
          description: 'desc',
        },
        (observerResult: api.ObserverResult) => {
          observerResult.observe(getCpuUsage(), { pid: '123', core: '1' });
          observerResult.observe(getCpuUsage(), { pid: '123', core: '2' });
          observerResult.observe(getCpuUsage(), { pid: '123', core: '3' });
          observerResult.observe(getCpuUsage(), { pid: '123', core: '4' });
        }
      ) as ValueObserverMetric;

      function getCpuUsage() {
        return Math.random();
      }

      const metricRecords: MetricRecord[] = await valueRecorder.getMetricRecord();
      assert.strictEqual(metricRecords.length, 4);

      const metric1 = metricRecords[0];
      const metric2 = metricRecords[1];
      const metric3 = metricRecords[2];
      const metric4 = metricRecords[3];
      assert.strictEqual(hashLabels(metric1.labels), '|#core:1,pid:123');
      assert.strictEqual(hashLabels(metric2.labels), '|#core:2,pid:123');
      assert.strictEqual(hashLabels(metric3.labels), '|#core:3,pid:123');
      assert.strictEqual(hashLabels(metric4.labels), '|#core:4,pid:123');

      ensureMetric(metric1);
      ensureMetric(metric2);
      ensureMetric(metric3);
      ensureMetric(metric4);
    });

    it('should pipe through resource', async () => {
      const valueObserver = meter.createValueObserver('name', {}, result => {
        result.observe(42, { foo: 'bar' });
      }) as ValueObserverMetric;
      assert.ok(valueObserver.resource instanceof Resource);

      const [record] = await valueObserver.getMetricRecord();
      assert.ok(record.resource instanceof Resource);
    });
  });

  describe('#batchObserver', () => {
    it('should create a batch observer', () => {
      const measure = meter.createBatchObserver('name', () => {});
      assert.ok(measure instanceof Metric);
    });

    it('should create batch observer with options', () => {
      const measure = meter.createBatchObserver('name', () => {}, {
        description: 'desc',
        unit: '1',
        disabled: false,
        maxTimeoutUpdateMS: 100,
      });
      assert.ok(measure instanceof Metric);
    });

    it('should use callback to observe values ', async () => {
      const tempMetric = meter.createValueObserver('cpu_temp_per_app', {
        description: 'desc',
      }) as ValueObserverMetric;

      const cpuUsageMetric = meter.createValueObserver('cpu_usage_per_app', {
        description: 'desc',
      }) as ValueObserverMetric;

      meter.createBatchObserver(
        'metric_batch_observer',
        observerBatchResult => {
          interface StatItem {
            usage: number;
            temp: number;
          }

          interface Stat {
            name: string;
            core1: StatItem;
            core2: StatItem;
          }

          function someAsyncMetrics() {
            return new Promise(resolve => {
              const stats: Stat[] = [
                {
                  name: 'app1',
                  core1: { usage: 2.1, temp: 67 },
                  core2: { usage: 3.1, temp: 69 },
                },
                {
                  name: 'app2',
                  core1: { usage: 1.2, temp: 67 },
                  core2: { usage: 4.5, temp: 69 },
                },
              ];
              resolve(stats);
            });
          }

          Promise.all([
            someAsyncMetrics(),
            // simulate waiting
            new Promise((resolve, reject) => {
              setTimeout(resolve, 1);
            }),
          ]).then((stats: unknown[]) => {
            const apps = (stats[0] as unknown) as Stat[];
            apps.forEach(app => {
              observerBatchResult.observe({ app: app.name, core: '1' }, [
                tempMetric.observation(app.core1.temp),
                cpuUsageMetric.observation(app.core1.usage),
              ]);
              observerBatchResult.observe({ app: app.name, core: '2' }, [
                tempMetric.observation(app.core2.temp),
                cpuUsageMetric.observation(app.core2.usage),
              ]);
            });
          });
        }
      );

      await meter.collect();

      const tempMetricRecords: MetricRecord[] = await tempMetric.getMetricRecord();
      const cpuUsageMetricRecords: MetricRecord[] = await cpuUsageMetric.getMetricRecord();
      assert.strictEqual(tempMetricRecords.length, 4);
      assert.strictEqual(cpuUsageMetricRecords.length, 4);

      const metric1 = tempMetricRecords[0];
      const metric2 = tempMetricRecords[1];
      const metric3 = tempMetricRecords[2];
      const metric4 = tempMetricRecords[3];
      assert.strictEqual(hashLabels(metric1.labels), '|#app:app1,core:1');
      assert.strictEqual(hashLabels(metric2.labels), '|#app:app1,core:2');
      assert.strictEqual(hashLabels(metric3.labels), '|#app:app2,core:1');
      assert.strictEqual(hashLabels(metric4.labels), '|#app:app2,core:2');

      ensureMetric(metric1, 'cpu_temp_per_app', {
        count: 1,
        last: 67,
        max: 67,
        min: 67,
        sum: 67,
      });
      ensureMetric(metric2, 'cpu_temp_per_app', {
        count: 1,
        last: 69,
        max: 69,
        min: 69,
        sum: 69,
      });
      ensureMetric(metric3, 'cpu_temp_per_app', {
        count: 1,
        last: 67,
        max: 67,
        min: 67,
        sum: 67,
      });
      ensureMetric(metric4, 'cpu_temp_per_app', {
        count: 1,
        last: 69,
        max: 69,
        min: 69,
        sum: 69,
      });

      const metric5 = cpuUsageMetricRecords[0];
      const metric6 = cpuUsageMetricRecords[1];
      const metric7 = cpuUsageMetricRecords[2];
      const metric8 = cpuUsageMetricRecords[3];
      assert.strictEqual(hashLabels(metric1.labels), '|#app:app1,core:1');
      assert.strictEqual(hashLabels(metric2.labels), '|#app:app1,core:2');
      assert.strictEqual(hashLabels(metric3.labels), '|#app:app2,core:1');
      assert.strictEqual(hashLabels(metric4.labels), '|#app:app2,core:2');

      ensureMetric(metric5, 'cpu_usage_per_app', {
        count: 1,
        last: 2.1,
        max: 2.1,
        min: 2.1,
        sum: 2.1,
      });
      ensureMetric(metric6, 'cpu_usage_per_app', {
        count: 1,
        last: 3.1,
        max: 3.1,
        min: 3.1,
        sum: 3.1,
      });
      ensureMetric(metric7, 'cpu_usage_per_app', {
        count: 1,
        last: 1.2,
        max: 1.2,
        min: 1.2,
        sum: 1.2,
      });
      ensureMetric(metric8, 'cpu_usage_per_app', {
        count: 1,
        last: 4.5,
        max: 4.5,
        min: 4.5,
        sum: 4.5,
      });
    });

    it('should not observe values when timeout', done => {
      const cpuUsageMetric = meter.createValueObserver('cpu_usage_per_app', {
        description: 'desc',
      }) as ValueObserverMetric;

      meter.createBatchObserver(
        'metric_batch_observer',
        observerBatchResult => {
          Promise.all([
            // simulate waiting 11ms
            new Promise((resolve, reject) => {
              setTimeout(resolve, 11);
            }),
          ]).then(async () => {
            // try to hack to be able to update
            (observerBatchResult as BatchObserverResult).cancelled = false;
            observerBatchResult.observe({ foo: 'bar' }, [
              cpuUsageMetric.observation(123),
            ]);

            // simulate some waiting
            await setTimeout(() => {}, 5);

            const cpuUsageMetricRecords: MetricRecord[] = await cpuUsageMetric.getMetricRecord();
            const value = cpuUsageMetric
              .bind({ foo: 'bar' })
              .getAggregator()
              .toPoint().value as Distribution;

            assert.deepStrictEqual(value, {
              count: 0,
              last: 0,
              max: -Infinity,
              min: Infinity,
              sum: 0,
            });
            assert.strictEqual(cpuUsageMetricRecords.length, 0);
            done();
          });
        },
        {
          maxTimeoutUpdateMS: 10, // timeout after 10ms
        }
      );

      meter.collect();
    });

    it('should pipe through instrumentation library', async () => {
      const observer = meter.createValueObserver(
        'name',
        {},
        (observerResult: api.ObserverResult) => {
          observerResult.observe(42, { foo: 'bar' });
        }
      ) as ValueObserverMetric;
      assert.ok(observer.instrumentationLibrary);

      const [record] = await observer.getMetricRecord();
      const { name, version } = record.instrumentationLibrary;
      assert.strictEqual(name, 'test-meter');
      assert.strictEqual(version, '*');
    });
  });

  describe('#getMetrics', () => {
    it('should create a DOUBLE counter', async () => {
      const key = 'key';
      const counter = meter.createCounter('counter', {
        description: 'test',
      });
      const labels = { [key]: 'counter-value' };
      const boundCounter = counter.bind(labels);
      boundCounter.add(10.45);

      await meter.collect();
      const record = meter.getBatcher().checkPointSet();

      assert.strictEqual(record.length, 1);
      assert.deepStrictEqual(record[0].descriptor, {
        name: 'counter',
        description: 'test',
        metricKind: MetricKind.COUNTER,
        unit: '1',
        valueType: api.ValueType.DOUBLE,
      });
      assert.strictEqual(record[0].labels, labels);
      const value = record[0].aggregator.toPoint().value as Sum;
      assert.strictEqual(value, 10.45);
    });

    it('should create an INT counter', async () => {
      const key = 'key';
      const counter = meter.createCounter('counter', {
        description: 'test',
        valueType: api.ValueType.INT,
      });
      const labels = { [key]: 'counter-value' };
      const boundCounter = counter.bind(labels);
      boundCounter.add(10.45);

      await meter.collect();
      const record = meter.getBatcher().checkPointSet();

      assert.strictEqual(record.length, 1);
      assert.deepStrictEqual(record[0].descriptor, {
        name: 'counter',
        description: 'test',
        metricKind: MetricKind.COUNTER,
        unit: '1',
        valueType: api.ValueType.INT,
      });
      assert.strictEqual(record[0].labels, labels);
      const value = record[0].aggregator.toPoint().value as Sum;
      assert.strictEqual(value, 10);
    });
  });

  it('should allow custom batcher', () => {
    const customMeter = new MeterProvider().getMeter('custom-batcher', '*', {
      batcher: new CustomBatcher(),
    });
    assert.throws(() => {
      const valueRecorder = customMeter.createValueRecorder('myValueRecorder');
      valueRecorder.bind({}).record(1);
    }, /aggregatorFor method not implemented/);
  });
});

class CustomBatcher extends Batcher {
  process(record: MetricRecord): void {
    throw new Error('process method not implemented.');
  }
  aggregatorFor(metricKind: MetricDescriptor): Aggregator {
    throw new Error('aggregatorFor method not implemented.');
  }
}

function ensureMetric(
  metric: MetricRecord,
  name?: string,
  value?: Distribution
) {
  assert.ok(metric.aggregator instanceof MinMaxLastSumCountAggregator);
  const distribution = metric.aggregator.toPoint().value as Distribution;
  if (value) {
    assert.deepStrictEqual(distribution, value);
  } else {
    assert.ok(distribution.last >= 0 && distribution.last <= 1);
  }
  const descriptor = metric.descriptor;
  assert.strictEqual(descriptor.name, name || 'name');
  assert.strictEqual(descriptor.description, 'desc');
  assert.strictEqual(descriptor.unit, '1');
  assert.strictEqual(descriptor.metricKind, MetricKind.VALUE_OBSERVER);
  assert.strictEqual(descriptor.valueType, api.ValueType.DOUBLE);
}
