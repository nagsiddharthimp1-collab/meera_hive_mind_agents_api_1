interface SystemInfo {
  device: string | null;
  location: string | null;
  network: string | null;
}

let systemInfoPromise: Promise<SystemInfo> | null = null;

const fetchSystemInfo = async (): Promise<SystemInfo> => {
  // 1. Get Device Info
  let deviceString: string | null = null;
  try {
    const device = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      pixelRatio: window.devicePixelRatio,
    };
    deviceString = JSON.stringify(device);
  } catch (error) {
    console.warn('Could not get device info:', error);
  }

  // 2. Get Network Info
  let networkString: string | null = null;
  type NetworkInformation = {
    effectiveType: 'slow-2g' | '2g' | '3g' | '4g';
    downlink: number;
    rtt: number;
    saveData: boolean;
    type: 'bluetooth' | 'cellular' | 'ethernet' | 'none' | 'wifi' | 'wimax' | 'other' | 'unknown';
  };
  if ('connection' in navigator) {
    const connection = (navigator as Navigator & { connection: NetworkInformation }).connection;
    if (connection) {
      try {
        const network = {
          effectiveType: connection.effectiveType,
          downlink: connection.downlink,
          rtt: connection.rtt,
          saveData: connection.saveData,
          type: connection.type,
        };
        networkString = JSON.stringify(network);
      } catch (error) {
        console.warn('Could not get network info:', error);
      }
    }
  }

  // 3. Get Location Info
  const getLocation = (): Promise<string | null> => {
    return new Promise((resolve) => {
      // Location tracking disabled to avoid permission prompts
      resolve(null);

      /* Original location code 
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const location = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
            };
            resolve(JSON.stringify(location));
          },
          (error) => {
            console.warn(`Geolocation error: ${error.message}`);
            resolve(null);
          },
          {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 60000,
          }
        );
      } else {
        console.warn("Geolocation not supported");
        resolve(null); // Resolve with null if not supported
      }
      */
    });
  };

  const locationString = await getLocation();

  return {
    device: deviceString,
    location: locationString,
    network: networkString,
  };
};

export const getSystemInfo = (): Promise<SystemInfo> => {
  if (typeof window !== 'undefined') {
    if (!systemInfoPromise) {
      systemInfoPromise = fetchSystemInfo();
    }
    return systemInfoPromise;
  } else {
    // Return a promise with null values for SSR
    return Promise.resolve({
      device: null,
      location: null,
      network: null,
    });
  }
};

export const isIOS = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  // Standard check for iOS devices
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream: unknown }).MSStream;
};
