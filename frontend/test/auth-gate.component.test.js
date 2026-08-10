import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

function createSessionManager({ signIn, signUp }) {
  let snapshot = {
    status: "anonymous",
    session: null,
    user: null,
    companionId: null,
    error: null,
  };
  const listeners = new Set();

  function publish(patch) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener({ ...snapshot }));
  }

  return {
    getSnapshot: () => ({ ...snapshot }),
    isConfigured: () => true,
    initialize: async () => ({ ...snapshot }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getRequestContext: async () => ({}),
    signUp: (payload) => signUp({ payload, publish }),
    signIn: (payload) => signIn({ payload, publish }),
  };
}

function textContent(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  return (node.children || []).map(textContent).join("");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function renderGate(AuthGate, sessionManager) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        AuthGate,
        { sessionManager },
        React.createElement("div", null, "authenticated"),
      ),
    );
  });
  return renderer;
}

const vite = await createServer({
  root: projectRoot,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const { default: AuthGate } = await vite.ssrLoadModule("/src/AuthGate.jsx");

  {
    const signUpResponse = deferred();
    const manager = createSessionManager({
      async signUp({ publish }) {
        publish({ status: "authenticating", error: null });
        await signUpResponse.promise;
        publish({ status: "anonymous", error: null });
        return { emailVerificationRequired: true };
      },
      async signIn() {
        throw new Error("not used");
      },
    });
    const renderer = await renderGate(AuthGate, manager);

    const tabs = renderer.root.findAll(
      (node) => node.type === "button" && node.props.role === "tab",
    );
    assert.equal(tabs.length, 2);
    await act(async () => tabs[1].props.onClick());

    const inputs = renderer.root.findAll((node) => node.type === "input");
    const nameInput = inputs.find((node) => node.props.type === "text");
    const emailInput = inputs.find((node) => node.props.type === "email");
    const passwordInput = inputs.find((node) => node.props.type === "password");
    await act(async () => {
      nameInput.props.onChange({ target: { value: "桃桃" } });
      emailInput.props.onChange({ target: { value: "taotao@example.test" } });
      passwordInput.props.onChange({ target: { value: "example-password" } });
    });

    const form = renderer.root.findByType("form");
    let submitPromise;
    await act(async () => {
      submitPromise = form.props.onSubmit({ preventDefault() {} });
      await Promise.resolve();
    });

    const pendingInputs = renderer.root.findAll(
      (node) => node.type === "input",
    );
    assert.equal(
      pendingInputs.find((node) => node.props.type === "email")?.props.value,
      "taotao@example.test",
      "registration fields must survive the intermediate authenticating state",
    );

    signUpResponse.resolve();
    await act(async () => {
      await submitPromise;
    });

    const verificationPanels = renderer.root.findAll(
      (node) => node.props.className === "auth-verification",
    );
    assert.equal(
      verificationPanels.length,
      1,
      "registration must remain on the verification result when auth status changes",
    );
    assert.match(textContent(renderer.toJSON()), /taotao@example\.test/);
    await act(async () => renderer.unmount());
  }

  {
    const expectedError = "测试登录失败，请重新检查邮箱或密码。";
    const manager = createSessionManager({
      async signUp() {
        throw new Error("not used");
      },
      async signIn({ publish }) {
        publish({ status: "authenticating", error: null });
        await Promise.resolve();
        const error = new Error(expectedError);
        publish({ status: "anonymous", error });
        throw error;
      },
    });
    const renderer = await renderGate(AuthGate, manager);
    const inputs = renderer.root.findAll((node) => node.type === "input");
    const emailInput = inputs.find((node) => node.props.type === "email");
    const passwordInput = inputs.find((node) => node.props.type === "password");
    await act(async () => {
      emailInput.props.onChange({ target: { value: "taotao@example.test" } });
      passwordInput.props.onChange({ target: { value: "wrong-password" } });
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    assert.match(
      textContent(renderer.toJSON()),
      new RegExp(expectedError),
      "a failed sign-in must keep a visible error instead of silently clearing the form",
    );
    await act(async () => renderer.unmount());
  }
} finally {
  await vite.close();
}

console.log("AuthGate component state regression tests passed");
