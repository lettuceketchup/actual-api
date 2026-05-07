import api from '@actual-app/api';

let initialized = false;

export async function initClient() {
  const {
    ACTUAL_DATA_DIR,
    ACTUAL_SERVER_URL,
    ACTUAL_PASSWORD,
    ACTUAL_SYNC_ID,
  } = process.env;

  const config = {};

  if (ACTUAL_DATA_DIR) {
    config.dataDir = ACTUAL_DATA_DIR;
  } else if (ACTUAL_SERVER_URL) {
    config.serverURL = ACTUAL_SERVER_URL;
    config.password = ACTUAL_PASSWORD;
  } else {
    throw new Error(
      'Missing connection config. Set ACTUAL_DATA_DIR or (ACTUAL_SERVER_URL + ACTUAL_PASSWORD + ACTUAL_SYNC_ID) in .env'
    );
  }

  await api.init(config);

  if (ACTUAL_SERVER_URL && ACTUAL_SYNC_ID) {
    await api.downloadBudget(ACTUAL_SYNC_ID);
  }

  initialized = true;
}

export async function shutdownClient() {
  if (initialized) {
    await api.shutdown();
    initialized = false;
  }
}

export { api };
