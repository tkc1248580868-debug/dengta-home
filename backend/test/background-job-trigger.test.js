const assert = require("node:assert/strict");
const {
    createBackgroundJobTrigger
} = require("../services/background-job-trigger");

function request(headers = {}) {
    return { headers };
}

function response() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

async function invoke(handler, headers = {}) {
    const res = response();
    await handler(request(headers), res);
    return res;
}

async function testFailsClosedWhenDisabledOrSecretMissing() {
    let runs = 0;
    const worker = {
        async runOnce() {
            runs += 1;
        }
    };

    const disabled = createBackgroundJobTrigger({
        worker,
        secret: "internal-job-secret",
        enabled: false,
        budgetMs: 25
    });
    const disabledResponse = await invoke(disabled, {
        authorization: "Bearer internal-job-secret"
    });

    assert.equal(disabledResponse.statusCode, 503);
    assert.deepEqual(disabledResponse.body, {
        ok: false,
        code: "background_job_trigger_unavailable"
    });

    const missingSecret = createBackgroundJobTrigger({
        worker,
        secret: "   ",
        enabled: true,
        budgetMs: 25
    });
    const missingSecretResponse = await invoke(missingSecret, {
        authorization: "Bearer anything"
    });

    assert.equal(missingSecretResponse.statusCode, 503);
    assert.deepEqual(missingSecretResponse.body, {
        ok: false,
        code: "background_job_trigger_unavailable"
    });
    assert.equal(runs, 0);
}

async function testRejectsMissingMalformedOrWrongCredentials() {
    const secret = "internal-job-secret";
    let runs = 0;
    const handler = createBackgroundJobTrigger({
        worker: {
            async runOnce() {
                runs += 1;
            }
        },
        secret,
        enabled: true,
        budgetMs: 25
    });

    const attempts = [
        {},
        { authorization: "Basic internal-job-secret" },
        { authorization: "Bearer wrong" },
        { "x-dengta-job-secret": "wrong-secret-of-another-length" }
    ];

    for (const headers of attempts) {
        const res = await invoke(handler, headers);
        assert.equal(res.statusCode, 401);
        assert.deepEqual(res.body, {
            ok: false,
            code: "background_job_trigger_unauthorized"
        });
        assert.equal(JSON.stringify(res.body).includes(secret), false);
    }
    assert.equal(runs, 0);
}

async function testAcceptsEitherSupportedCredentialAndRunsOnce() {
    const secret = "internal-job-secret";
    let runs = 0;
    const handler = createBackgroundJobTrigger({
        worker: {
            async runOnce() {
                runs += 1;
                return {
                    completed: 1,
                    private_worker_result: secret
                };
            }
        },
        secret,
        enabled: true,
        budgetMs: 25
    });

    const bearerResponse = await invoke(handler, {
        authorization: `Bearer ${secret}`
    });
    assert.equal(bearerResponse.statusCode, 200);
    assert.deepEqual(bearerResponse.body, {
        ok: true,
        code: "background_job_trigger_completed",
        status: "completed"
    });
    assert.equal(JSON.stringify(bearerResponse.body).includes(secret), false);
    assert.equal(runs, 1);

    const internalHeaderResponse = await invoke(handler, {
        "X-DengTa-Job-Secret": secret
    });
    assert.equal(internalHeaderResponse.statusCode, 200);
    assert.deepEqual(internalHeaderResponse.body, {
        ok: true,
        code: "background_job_trigger_completed",
        status: "completed"
    });
    assert.equal(
        JSON.stringify(internalHeaderResponse.body).includes(secret),
        false
    );
    assert.equal(runs, 2);
}

async function testReturnsAcceptedAtBudgetWithoutInterruptingWorker() {
    const secret = "internal-job-secret";
    let runs = 0;
    let completeRun;
    let workerCompleted = false;
    const workerCompletion = new Promise((resolve) => {
        completeRun = () => {
            workerCompleted = true;
            resolve();
        };
    });
    const handler = createBackgroundJobTrigger({
        worker: {
            runOnce() {
                runs += 1;
                return workerCompletion;
            }
        },
        secret,
        enabled: true,
        budgetMs: 10
    });

    const res = await Promise.race([
        invoke(handler, {
            authorization: `Bearer ${secret}`
        }),
        new Promise((_, reject) => {
            setTimeout(() => {
                reject(
                    new Error(
                        "Background job trigger did not honor its response budget."
                    )
                );
            }, 100);
        })
    ]);

    assert.equal(res.statusCode, 202);
    assert.deepEqual(res.body, {
        ok: true,
        code: "background_job_trigger_accepted",
        status: "running"
    });
    assert.equal(runs, 1);
    assert.equal(workerCompleted, false);

    completeRun();
    await workerCompletion;
    assert.equal(workerCompleted, true);
    assert.equal(runs, 1);
}

async function testReturnsFixedFailureWithoutLeakingWorkerError() {
    const secret = "internal-job-secret";
    let runs = 0;
    const handler = createBackgroundJobTrigger({
        worker: {
            runOnce() {
                runs += 1;
                throw new Error(
                    `provider failed while using ${secret}`
                );
            }
        },
        secret,
        enabled: true,
        budgetMs: 25
    });

    const res = await invoke(handler, {
        "x-dengta-job-secret": secret
    });

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, {
        ok: false,
        code: "background_job_trigger_failed"
    });
    assert.equal(JSON.stringify(res.body).includes(secret), false);
    assert.equal(runs, 1);
}

testFailsClosedWhenDisabledOrSecretMissing()
    .then(testRejectsMissingMalformedOrWrongCredentials)
    .then(testAcceptsEitherSupportedCredentialAndRunsOnce)
    .then(testReturnsAcceptedAtBudgetWithoutInterruptingWorker)
    .then(testReturnsFixedFailureWithoutLeakingWorkerError)
    .then(() => {
        console.log("background job trigger tests passed");
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
