// 获取环境变量值，带默认值
function getEnvNumber(envKey, defaultValue) {
  const value = parseInt(process.env[envKey], 10);
  return isNaN(value) ? defaultValue : value;
}

const CONSTANTS = {
  REQUIRED_DEPENDENCIES: [
    { name: "request", package: "request" },
    { name: "querystring", package: "querystring" },
    { name: "socks-proxy-agent", package: "socks-proxy-agent" }
  ],
  API_BASE_URL: "https://api.e.kuaishou.com",
  VERSION_CHECK_URL: "http://111.230.67.125:5451/",
  QUEUE_STATUS_PATH: "/queue_status",
  PROXY_API_PATH: "/proxySign",
  USER_INFO_COLLECT_PATH: "/user_info_collector/collect.php",
  DEFAULT_USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  ANDROID_USER_AGENT: "kwai-android aegon/4.9.1",
  DEFAULT_PROXY_PORT: 1080,
  LOW_REWARD_THRESHOLD: getEnvNumber("ksjbz", 10),    // 低奖励阈值（金币），可通过环境变量覆盖
  LOW_REWARD_LIMIT: getEnvNumber("ksjbcs", 3),         // 连续低奖励停止次数，可通过环境变量覆盖
  MAX_RETRY_COUNT: 3,          // 默认接口重试次数
  MAX_TASK_RETRY: 3,           // 任务轮次最大重试次数
  ksjsb_xc: 8,     // 默认多账号并发数
  DEFAULT_MIN_COIN_THRESHOLD: 600000,  // 默认初始金币阈值
  TASK_CONFIGS: {              // 广告任务配置（业务核心参数）
    box: {
      name: "宝箱广告",
      encDataKey: "boxencData",
      signKey: "boxsign",
      businessId: 606,
      posId: 20346,
      subPageId: 100024064,
      requestSceneType: 1,
      taskType: 1
    },
    look: {
      name: "看广告得金币",
      encDataKey: "encData",
      signKey: "sign",
      businessId: 672,
      posId: 24067,
      subPageId: 100026367,
      requestSceneType: 1,
      taskType: 1
    },
    food: {
      name: "饭补广告",
      encDataKey: "fbencData",
      signKey: "fbsign",
      businessId: 9362,
      posId: 24067,
      subPageId: 100026367,
      requestSceneType: 7,
      taskType: 2
    },
    seek: {
      name: "搜索广告",
      encDataKey: "skencData",
      signKey: "sksign",
      businessId: 7038,
      posId: 96134,
      subPageId: 100074584,
      requestSceneType: 1,
      taskType: 1
    },
    seeks: {
      name: "搜索广告[追加]",
      encDataKey: "skencData",
      signKey: "sksign",
      businessId: 7038,
      posId: 96134,
      subPageId: 100074584,
      requestSceneType: 7,
      taskType: 2
    },
    looks: {
      name: "看广告得金币[追加]",
      encDataKey: "encData",
      signKey: "sign",
      businessId: 672,
      posId: 24067,
      subPageId: 100026367,
      requestSceneType: 7,
      taskType: 2
    }
  },
  CURRENT_VERSION: "1.2.6",     // 当前程序版本
  APP_NAME: "快手极速版",        // 应用名称
  TASK_LOGGER_NAME: "快速任务"  // 日志器名称
};

// 1. 依赖检查：确保必需库已安装
function checkRequiredDependencies() {
  const missingPackages = [];

  for (const dep of CONSTANTS.REQUIRED_DEPENDENCIES) {
    try {
      require(dep.name);
    } catch (error) {
      missingPackages.push(dep.package);
    }
  }

  if (missingPackages.length > 0) {
    console.log("❌ 缺少以下必需的库依赖:");
    missingPackages.forEach(pkg => console.log(`   - ${pkg}`));
    console.log("\n请运行以下命令安装缺失的依赖:");
    console.log(`npm install ${missingPackages.join(" ")}`);
    console.log("\n或者运行以下命令安装所有依赖:");
    console.log("npm install");
    process.exit(1);
  }

  console.log("✅ 所有必需的库依赖检查通过");
}

// 引入依赖（依赖检查后引入，避免提前报错）
const request = require("request");
const querystring = require("querystring");
const { SocksProxyAgent } = require("socks-proxy-agent");

// 2. 工具函数：通用工具（代理解析、版本比较、随机延迟等）
const Toolkit = {
  /**
   * 解析代理配置字符串
   * @param {string} proxyStr - 代理字符串（格式：地址|端口|账号|密码 或 地址:端口）
   * @returns {Object|null} 代理配置（{host, port, auth?}）或null（解析失败）
   */
  parseProxyConfig(proxyStr) {
    if (!proxyStr || !proxyStr.trim()) return null;

    try {
      // 格式1：地址|端口|账号|密码
      if (proxyStr.includes("|")) {
        const parts = proxyStr.split("|");
        if (parts.length >= 2) {
          const [host, port, authUser, authPwd] = parts;
          return {
            host: host.trim(),
            port: parseInt(port.trim(), 10) || CONSTANTS.DEFAULT_PROXY_PORT,
            auth: authUser && authPwd ? `${authUser.trim()}:${authPwd.trim()}` : undefined
          };
        }
      }

      // 格式2：地址:端口
      if (proxyStr.includes(":")) {
        const [host, port] = proxyStr.split(":");
        return {
          host: host.trim(),
          port: parseInt(port.trim(), 10) || CONSTANTS.DEFAULT_PROXY_PORT
        };
      }

      // 格式3：仅地址（默认端口）
      return {
        host: proxyStr.trim(),
        port: CONSTANTS.DEFAULT_PROXY_PORT
      };
    } catch (error) {
      console.log(`代理配置解析失败: ${proxyStr}, 错误: ${error.message}`);
      return null;
    }
  },

  /**
   * 比较版本号（语义化版本：x.y.z）
   * @param {string} currentVer - 当前版本
   * @param {string} targetVer - 目标版本
   * @returns {number} 1(当前新) / -1(目标新) / 0(相同)
   */
  compareVersion(currentVer, targetVer) {
    try {
      const currentParts = currentVer.split(".").map(num => parseInt(num, 10) || 0);
      const targetParts = targetVer.split(".").map(num => parseInt(num, 10) || 0);
      const maxLen = Math.max(currentParts.length, targetParts.length);

      for (let i = 0; i < maxLen; i++) {
        const current = currentParts[i] || 0;
        const target = targetParts[i] || 0;

        if (current > target) return 1;
        if (current < target) return -1;
      }

      return 0;
    } catch (error) {
      return 0; // 解析失败时视为版本相同
    }
  },

  /**
   * 生成随机延迟（30-40秒）
   * @returns {number} 延迟毫秒数
   */
  getRandomDelay() {
    return Math.floor(10001 * Math.random()) + 30000;
  },

  /**
   * 检查是否为Node环境
   * @returns {boolean} 是否为Node环境
   */
  isNodeEnv() {
    return typeof process !== "undefined" && process.versions?.node;
  },

  /**
   * 获取环境变量（适配青龙面板的 & 分隔）
   * @param {string} key - 环境变量名
   * @param {any} defaultValue - 默认值
   * @returns {Array<string>} 解析后的环境变量值数组
   */
  getEnv(key, defaultValue = []) {
    if (!this.isNodeEnv()) return defaultValue;

    const envValue = process.env[key];
    if (!envValue) return defaultValue;

    // 确保用 & 分割多账号，同时过滤空值和空格
    return envValue.split("&")
      .map(item => item.trim())
      .filter(item => item !== "");
  },

  /**
   * 格式化数字为带千分位的字符串
   * @param {number} num - 要格式化的数字
   * @returns {string} 格式化后的字符串
   */
  formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
};

// 3. 日志工具类：统一日志输出
class TaskLogger {
  constructor(name) {
    this.name = name;
    this.logs = [];
    console.log(`🔔 ${this.name}, 开始!`);
  }

  /**
   * 打印日志
   * @param  {...any} args - 日志内容
   */
  log(...args) {
    this.logs.push(...args);
    console.log(...args);
  }

  /**
   * 结束日志（打印结束信息）
   */
  done() {
    console.log(`🔔 ${this.name}, 结束!`);
    process.exit(0);
  }

  /**
   * 获取数据（兼容原逻辑，暂返回null）
   * @param {string} key - 数据键名
   * @returns {null} 暂返回null
   */
  getData(key) {
    return null; // 原逻辑无实际实现，保持兼容
  }
}

// 4. HTTP请求工具：统一请求处理（支持代理、JSON解析）
class RequestClient {
  /**
   * 发起HTTP请求
   * @param {Object} options - 请求配置（method, url, headers, body/form等）
   * @param {Object|null} proxyConfig - 代理配置（{host, port, auth?}）
   * @returns {Promise<any>} 请求结果（JSON解析后或原始内容）
   */
  static async makeRequest(options, proxyConfig = null) {
    // 处理代理配置
    if (proxyConfig) {
      try {
        let proxyUrl = `socks5://${proxyConfig.host}:${proxyConfig.port}`;
        if (proxyConfig.auth) {
          proxyUrl = `socks5://${proxyConfig.auth}@${proxyConfig.host}:${proxyConfig.port}`;
        }

        const agent = new SocksProxyAgent(proxyUrl);
        options.agent = agent;

        // 开发模式打印代理信息
        if (this.isDevMode()) {
          console.log(`使用代理: ${proxyConfig.host}:${proxyConfig.port}`);
        }
      } catch (error) {
        console.log(`代理配置错误: ${error.message}`);
      }
    }

    // 返回Promise封装的请求
    return new Promise((resolve) => {
      request(options, (error, response, body) => {
        // 处理请求错误
        if (error) {
          console.log(`请求错误: 网络连接失败，请检查网络状态`);
          if (this.isDevMode()) {
            console.log(`错误类型: ${error.code || "未知"}`);
            this._logErrorDetail(error.code);
          }
          return resolve(null);
        }

        // 处理HTTP状态码错误
        if (response && response.statusCode && response.statusCode !== 200) {
          console.log(`HTTP状态码错误: ${response.statusCode}`);
          if (this.isDevMode()) {
            console.log(`响应头: ${JSON.stringify(response.headers, null, 2)}`);
            this._logStatusCodeDetail(response.statusCode);
          }
        }

        // 处理响应内容（JSON解析）
        try {
          const result = JSON.parse(body);
          resolve(result);
        } catch (parseError) {
          console.log(`JSON解析失败: ${parseError.message}`);
          if (this.isDevMode()) {
            console.log(`原始响应内容: ${body.substring(0, 200)}...`);
          }
          resolve(body); // 解析失败返回原始内容
        }
      });
    });
  }

  /**
   * 检查是否为开发模式
   * @returns {boolean} 是否为开发模式
   */
  static isDevMode() {
    const devMode = Toolkit.getEnv("DEV_MODE")[0]; // 取第一个值判断
    return devMode === "true" || devMode === "1";
  }

  /**
   * 打印错误码详情（开发模式）
   * @param {string} code - 错误码
   */
  static _logErrorDetail(code) {
    const errorMap = {
      ECONNREFUSED: "连接被拒绝，可能是服务器不可用或网络问题",
      ETIMEDOUT: "请求超时，网络连接缓慢",
      ENOTFOUND: "域名解析失败，检查网络连接"
    };

    if (errorMap[code]) {
      console.log(errorMap[code]);
    }
  }

  /**
   * 打印状态码详情（开发模式）
   * @param {number} statusCode - HTTP状态码
   */
  static _logStatusCodeDetail(statusCode) {
    const statusMap = {
      404: "资源未找到，请检查URL是否正确",
      403: "访问被禁止，可能需要认证或权限不足",
      500: "服务器内部错误",
      '5xx': "服务器错误，请稍后重试"
    };

    if (statusMap[statusCode]) {
      console.log(statusMap[statusCode]);
    } else if (statusCode >= 500) {
      console.log(statusMap["5xx"]);
    }
  }
}

// 5. 快手广告任务核心类：单账号任务执行
class KuaishouAdTaskWorker {
  /**
   * 构造函数（初始化账号配置、任务状态）
   * @param {Object} accountConfig - 账号配置
   * @param {number} accountConfig.index - 账号序号
   * @param {string} accountConfig.salt - 签名盐值
   * @param {string} accountConfig.cookie - 账号Cookie
   * @param {Object|null} accountConfig.proxyConfig - 代理配置
   * @param {string} [accountConfig.nickname] - 账号昵称（可选）
   * @param {number} [accountConfig.minCoinThreshold] - 金币阈值
   */
  constructor(accountConfig) {
    this.index = accountConfig.index;
    this.salt = accountConfig.salt;
    this.cookie = accountConfig.cookie;
    this.proxyConfig = accountConfig.proxyConfig || null;
    this.remark = accountConfig.remark || '未获取昵称';
    // 添加kaw和kas参数支持
    this.kaw = accountConfig.kaw || null;
    this.kas = accountConfig.kas || null;
    // 初始化账号标识：包含序号和环境变量中的备注内容
    this.accountTag = `账号${this.index}[${this.remark}]`;
    // 从配置获取金币阈值，如未提供则使用默认值
    this.minCoinThreshold = accountConfig.minCoinThreshold || CONSTANTS.DEFAULT_MIN_COIN_THRESHOLD;

    // 解析Cookie中的关键信息（did/egid/userId等）
    this._extractCookieInfo();
    
    // 初始化请求头
    this.headers = this._buildBaseHeaders();
    // 1. query：URL查询参数（设备型号、appver、egid、did）
    this.query = "mod=Xiaomi(MI 11)&appver=" + this.appver + "&egid=" + this.egid + "&did=" + this.did;
    // 2. path：任务上报接口路径
    this.path = "/rest/r/ad/task/report";
    // 3. startTime/endTime：任务时间范围（当前时间-25秒）
    this.startTime = Date.now();
    this.endTime = this.startTime - 25000;
    
    // 初始化任务配置（根据黑白名单过滤）
    this.taskConfigs = this._initTaskConfigs();
    
    // 初始化任务状态（成功/失败次数、奖励等）
    this.taskStats = this._initTaskStats();
    
    // 低奖励控制配置
    this.lowRewardStreak = 0;
    this.lowRewardThreshold = CONSTANTS.LOW_REWARD_THRESHOLD;
    this.lowRewardLimit = CONSTANTS.LOW_REWARD_LIMIT;
    this.stopAllTasks = false;
    this.taskLimitReached = this._initTaskLimitStatus();
    
    // 新增：累计金币变量
    this.totalRewards = 0;

    // 开发模式打印任务启用信息
    if (RequestClient.isDevMode()) {
      const enabledTasks = Object.keys(this.taskConfigs).map(key => this.taskConfigs[key].name).join(",");
      console.log(`${this.accountTag} 已启用任务: ${enabledTasks || "无"}`);
      console.log(`${this.accountTag} 金币阈值: ${this.minCoinThreshold}`);
    }
  }

  /**
   * 解析Cookie中的关键信息（did/egid/userId/api_st/appver）
   */
  _extractCookieInfo() {
    try {
      const cookie = this.cookie;
      this.egid = this._matchCookieValue(cookie, "egid=([^;]+)");
      this.did = this._matchCookieValue(cookie, "did=([^;]+)");
      this.userId = this._matchCookieValue(cookie, "userId=([^;]+)");
      this.kuaishouApiSt = this._matchCookieValue(cookie, "kuaishou.api_st=([^;]+)");
      this.appver = this._matchCookieValue(cookie, "appver=([^;]+)");
      this.sys = this._matchCookieValue(cookie, "sys=([^;\s]+)") || "ANDROID_15"; // 默认值保持兼容

      // 检查关键信息是否缺失
      if (!this.egid || !this.did) {
        console.log(`${this.accountTag} cookie格式错误，缺少必要信息（egid/did）`);
      }
    } catch (error) {
      console.log(`${this.accountTag} 解析cookie失败: ${error.message}`);
    }
  }

  /**
   * 从Cookie中匹配指定键的值
   * @param {string} cookie - Cookie字符串
   * @param {string} regexPattern - 正则表达式（捕获组）
   * @returns {string} 匹配到的值或空字符串
   */
  _matchCookieValue(cookie, regexPattern) {
    const match = cookie.match(new RegExp(regexPattern));
    return match ? match[1] : "";
  }

  /**
   * 构建基础请求头
   * @returns {Object} 基础请求头
   */
  _buildBaseHeaders() {
    return {
      "Host": "nebula.kuaishou.com",
      "Connection": "keep-alive",
      "User-Agent": CONSTANTS.ANDROID_USER_AGENT,
      "Cookie": this.cookie,
      "content-type": "application/json"
    };
  }

  /**
   * 初始化任务配置（根据环境变量过滤黑白名单）
   * @returns {Object} 过滤后的任务配置
   */
  _initTaskConfigs() {
    const enabledTasks = new Set(this._getEnabledTaskTypes());
    const disabledTasks = new Set(this._getDisabledTaskTypes());    const filteredTasks = {};
    
    // 默认启用的五个任务（box、look、looks、food、seeks）
    const defaultEnabledTasks = ['box', 'look', 'looks', 'food', 'seeks'];

    // 遍历基础任务配置，按黑白名单过滤
    Object.keys(CONSTANTS.TASK_CONFIGS).forEach(taskKey => {
      const task = CONSTANTS.TASK_CONFIGS[taskKey];
      
      // 启用规则：
      // 1. 如果设置了启用名单，则使用名单内任务
      // 2. 如果没有设置启用名单，则默认启用前四个任务（box、look、looks、food）
      // 3. 始终排除禁用名单内任务
      const shouldEnable = enabledTasks.size > 0 
        ? enabledTasks.has(taskKey) 
        : defaultEnabledTasks.includes(taskKey);
        
      if (shouldEnable && !disabledTasks.has(taskKey)) {
        filteredTasks[taskKey] = task;
      }
    });

    return filteredTasks;
  }

  /**
   * 从环境变量获取启用的任务类型
   * @returns {Array<string>} 启用的任务类型数组
   */
  _getEnabledTaskTypes() {
    const enableEnv = Toolkit.getEnv("KS_TASKS_ENABLE") || Toolkit.getEnv("KS_TASKS_ENABLED") || [];
    return this._parseTaskList(enableEnv);
  }

  /**
   * 从环境变量获取禁用的任务类型
   * @returns {Array<string>} 禁用的任务类型数组
   */
  _getDisabledTaskTypes() {
    const disableEnv = Toolkit.getEnv("KS_TASKS_DISABLE") || Toolkit.getEnv("KS_TASKS_DISABLED") || [];
    return this._parseTaskList(disableEnv);
  }

  /**
   * 解析任务列表字符串（按分隔符拆分）
   * @param {Array<string>} taskList - 任务列表数组
   * @returns {Array<string>} 任务类型数组（小写）
   */
  _parseTaskList(taskList) {
    try {
      // 支持多种分隔符：逗号、分号、空格等
      const separator = new RegExp("[,;\\s]+");
      return taskList.flatMap(item => 
        item.split(separator)
          .map(task => task.trim().toLowerCase())
          .filter(Boolean)
      );
    } catch (error) {
      return [];
    }
  }

  /**
   * 初始化任务状态统计（成功/失败/奖励）
   * @returns {Object} 任务状态统计对象
   */
  _initTaskStats() {
    const stats = {};
    Object.keys(this.taskConfigs).forEach(taskKey => {
      stats[taskKey] = {
        success: 0,
        failed: 0,
        totalReward: 0
      };
    });
    return stats;
  }

  /**
   * 初始化任务上限状态（是否达到执行上限）
   * @returns {Object} 任务上限状态对象
   */
  _initTaskLimitStatus() {
    const limitStatus = {};
    Object.keys(this.taskConfigs).forEach(taskKey => {
      limitStatus[taskKey] = false;
    });
    return limitStatus;
  }

  /**
   * 带重试机制的操作执行
   * @param {Function} operation - 待执行的异步操作
   * @param {string} operationName - 操作名称（用于日志）
   * @param {number} maxRetry - 最大重试次数
   * @returns {Promise<any|null>} 操作结果或null（重试失败）
   */
  async _retryOperation(operation, operationName, maxRetry) {
    let retryCount = 0;
    let lastError = null;

    while (retryCount < maxRetry) {
      try {
        const result = await operation();
        if (result) return result;
        lastError = new Error(`${operationName}返回空结果`);
      } catch (error) {
        lastError = error;
        console.log(`${this.accountTag} ${operationName}异常: ${error.message}`);
        if (RequestClient.isDevMode() && error.stack) {
          console.log(`错误堆栈: ${error.stack.split("\n").slice(1, 4).join("\n")}`);
        }
      }

      retryCount++;
      // 未达最大重试次数时，延迟后重试
      if (retryCount < maxRetry) {
        console.log(`${this.accountTag} ${operationName}失败，重试${retryCount}/${maxRetry}`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    console.log(`${this.accountTag} ${operationName}失败，已达到最大重试次数`);
    if (RequestClient.isDevMode() && lastError) {
      console.log(`最终失败原因: ${lastError.message}`);
      if (lastError.code) console.log(`错误代码: ${lastError.code}`);
    }
    return null;
  }

  /**
   * 轮询队列状态（用于加密服务队列）
   * @param {string} queueId - 队列ID
   * @param {string} baseUrl - 队列服务基础URL
   * @param {number} timeout - 超时时间（毫秒）
   * @param {number} interval - 轮询间隔（毫秒）
   * @returns {Promise<Object>} 队列状态结果
   */
  async _pollQueueStatus(queueId, baseUrl, timeout = 60000, interval = 2000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const requestOptions = {
          method: "get",
          url: `${baseUrl}${CONSTANTS.QUEUE_STATUS_PATH}?queue_id=${encodeURIComponent(queueId)}`,
          headers: {
            "User-Agent": CONSTANTS.DEFAULT_USER_AGENT
          }
        };

        const response = await RequestClient.makeRequest(requestOptions);
        if (response && response.success) {
          // 处理完成/失败状态
          if (response.status === "completed" || response.status === "processed") {
            return response;
          }
          if (response.status === "failed") {
            return response;
          }
        }
      } catch (error) {
        console.log(`${this.accountTag} 队列状态查询异常: ${error.message}`);
      }

      // 间隔轮询
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    // 超时返回
    return {
      success: false,
      status: "failed",
      error: "queue_timeout"
    };
  }

  /**
   * 请求加密代理服务（带队列处理）
   * @param {Object} requestData - 加密请求数据
   * @returns {Promise<Object|null>} 加密服务响应或null
   */
  async _requestProxyWithQueue(requestData) {
    try {
      // 获取卡密环境变量
      const cardKey = Toolkit.getEnv("ks_km")[0];
      if (!cardKey) {
        console.log(`${this.accountTag} 未配置卡密(ks_km)环境变量，无法请求加密服务`);
        return null;
      }

      const baseUrl = CONSTANTS.VERSION_CHECK_URL;
      const requestOptions = {
        method: "post",
        url: `${baseUrl}${CONSTANTS.PROXY_API_PATH}?card_key=${encodeURIComponent(cardKey)}`,
        headers: {
          "User-Agent": CONSTANTS.DEFAULT_USER_AGENT,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestData)
      };

      // 发起加密请求
      const response = await RequestClient.makeRequest(requestOptions);
      if (!response) {
        console.log(`${this.accountTag} 加密代理服务无响应`);
        return null;
      }

      // 处理响应状态
      if (response.success) {
        // 直接处理完成状态
        if (!response.status || response.status === "processed" || response.status === "completed") {
          return response.data || response;
        }
        // 队列状态：轮询等待结果
        if (response.status === "queued" && response.queue_id) {
          const queueResult = await this._pollQueueStatus(response.queue_id, baseUrl);
          if (queueResult && queueResult.success && (queueResult.status === "completed" || queueResult.status === "processed")) {
            return queueResult.data || queueResult;
          }
          console.log(`${this.accountTag} 加密队列处理失败: ${queueResult.error || queueResult.message || queueResult.status}`);
          return null;
        }
      }

      console.log(`${this.accountTag} 加密代理返回失败: ${response.error || response.message || response.status || "未知错误"}`);
      return null;
    } catch (error) {
      console.log(`${this.accountTag} 加密代理请求异常: ${error.message}`);
      return null;
    }
  }

  /**
   * 生成签名（通用签名生成逻辑）
   * @param {string} creativeId - 广告创意ID
   * @param {string} llsid - 广告会话ID
   * @param {string} taskKey - 任务类型键（box/look/food）
   * @param {Object} taskConfig - 任务配置
   * @returns {Promise<Object|null>} 签名结果（sig/sig3/sigtoken等）
   */
  async _generateSignature(creativeId, llsid, taskKey, taskConfig) {
    try {
      // 构建业务参数字符串
      const bizStr = `bizStr={"businessId":${taskConfig.businessId},"endTime":${this.endTime},"extParams":"","mediaScene":"video","neoInfos":[{"creativeId":${creativeId},"extInfo":"","llsid":${llsid},"requestSceneType":${taskConfig.requestSceneType},"taskType":${taskConfig.taskType},"watchExpId":"","watchStage":0}],"pageId":11101,"posId":${taskConfig.posId},"reportType":0,"sessionId":"","startTime":${this.startTime},"subPageId":${taskConfig.subPageId}}&cs=false&client_key=2ac2a76d`;
      
      // 发起加密请求
      const requestData = {
        urldata: `${this.query}&${bizStr}`,
        api_client_salt: this.salt,
        urlpath: this.path
      };
      const signatureResult = await this._requestProxyWithQueue(requestData);

      if (signatureResult) {
        const data = signatureResult.data || signatureResult;
        return {
          sig: data.sig,
          sig3: data.__NS_sig3,
          sigtoken: data.__NStokensig,
          post: bizStr
        };
      }
      return null;
    } catch (error) {
      console.log(`${this.accountTag} 生成${taskConfig.name}签名异常: ${error.message}`);
      return null;
    }
  }

  /**
   * 生成签名2（用于广告信息请求）
   * @param {string} urlPath - 请求路径
   * @param {string} urlData - URL参数数据
   * @param {string} salt - 签名盐值
   * @param {string} reqStr - 请求字符串（base64编码）
   * @returns {Promise<Object|null>} 签名结果
   */
  async _generateSignature2(urlPath, urlData, salt, reqStr) {
    try {
      const requestData = {
        urlpath: urlPath,
        urldata: urlData,
        api_client_salt: salt,
        req_str: reqStr
      };
      const signatureResult = await this._requestProxyWithQueue(requestData);

      if (!signatureResult) {
        console.log(`${this.accountTag} 签名生成失败`);
        return null;
      }

      return signatureResult.data || signatureResult;
    } catch (error) {
      console.log(`${this.accountTag} 生成签名异常: ${error.message}`);
      if (RequestClient.isDevMode() && error.stack) {
        console.log(`错误堆栈: ${error.stack.split("\n").slice(1, 4).join("\n")}`);
      }
      return null;
    }
  }

  /**
   * 获取广告信息（基础版）
   * @param {Object} taskConfig - 任务配置
   * @returns {Promise<Object|null>} 广告信息（creativeId/llsid等）
   */
  async _getAdInfo(taskConfig) {
    try {
      // 构建基础请求配置
      const baseRequest = {
        method: "post",
        url: `${CONSTANTS.API_BASE_URL}/rest/e/reward/mixed/ad`,
        headers: {
          "Host": "api.e.kuaishou.com",
          "Connection": "keep-alive",
          "User-Agent": CONSTANTS.ANDROID_USER_AGENT,
          "Cookie": `kuaishou_api_st=${this.kuaishouApiSt}`,
          "kaw": this.kaw || "MDHkM+9FrbzBSEAqyw6KYGqGa3b3Y2gIZq3YJZrGkTfaYzm10bLlDdGjxtTP/Vsn9qY6EtUMxCHt4jSsI+tFr9Ghm+r+KqHlnsOvBH0tCt4Ooik1wJGFzJpMJlsk/JeN79ww0w+eSy/M9oLfga/mji6Accpfu1wNXI1lYVZ3blsdkEud+hPR1c9Qj/CgplRmsM+Tmu37HcBisfMQFIszemGwXI2U+aRzBNCli/sJt3/RWyBFmtkwDIFoTyTZoMd0+TUA",
          "kas": this.kas || "0016df70b7d4e188b70eea1ecf158ad175",
        },
        form: {
          encData: "|encData|",
          sign: "|sign|",
          cs: "false",
          client_key: "2ac2a76d",
          videoModelCrowdTag: "1_100",
          os: "android",
          "kuaishou.api_st": this.kuaishouApiSt,
          uQaTag: "66243#33333333338888888888#cmWns:21#swRs:79#swLdgl:-9#ecPp:59#cmNt:-0#cmHs:10#cmMnsl:-0#cmAu:-3"
        }
      };

      // 构建设备参数和广告参数
      const deviceParams = this._buildDeviceParams();
      const adParams = this._buildAdRequestParams(taskConfig);
      const adParamsStr = JSON.stringify(adParams);

      // 合并请求参数并生成签名
      const requestParams = { ...deviceParams, ...baseRequest.form };
      const signature = await this._generateSignature2(
        "/rest/e/reward/mixed/ad",
        querystring.stringify(requestParams),
        this.salt,
        Buffer.from(adParamsStr).toString("base64")
      );

      if (!signature) {
        console.log(`${this.accountTag} 生成签名失败，无法获取${taskConfig.name}信息`);
        return null;
      }

      // 填充签名到请求参数
      deviceParams.sig = signature.sig;
      deviceParams.__NS_sig3 = signature.__NS_sig3;
      deviceParams.__NS_xfalcon = "";
      deviceParams.__NStokensig = signature.__NStokensig;
      baseRequest.form.encData = signature.encData;
      baseRequest.form.sign = signature.sign;

      // 构建最终请求URL
      baseRequest.url = `${baseRequest.url}?${querystring.stringify(deviceParams)}`;

      // 发起请求并解析结果
      const response = await RequestClient.makeRequest(baseRequest, this.proxyConfig);
      if (!response) {
        console.log(`${this.accountTag} 请求${taskConfig.name}接口失败，无响应`);
        return null;
      }

      // 处理接口响应
      if (response.errorMsg === "OK") {
        // 打印原始数据（关键！用于排查实际值和类型）
        // console.log("原始feedType值:", response["feedType"], "类型:", typeof response["feedType"]);
        // console.log("原始video时长值:", response.feeds?.[0]?.ext_params?.video, "类型:", typeof response.feeds?.[0]?.ext_params?.video);

        // 严格转换feedType为数字（处理字符串"0"、null、undefined等情况）
        const feedType = Number(response["feedType"]);
        // 兜底处理：如果转换失败（NaN），默认按"其他"类型处理
        const finalFeedType = isNaN(feedType) ? 1 : feedType;

        // 严格转换视频时长为数字（处理字符串、null等）
        const materialTimeStr = response.feeds?.[0]?.ext_params?.video;
        const materialTime = Number(materialTimeStr);
        // 兜底处理：转换失败时用默认值30000
        const finalMaterialTime = isNaN(materialTime) ? 30000 : materialTime;

        const ad_duration_seconds = finalMaterialTime / 1000;

        // 打印转换后的值（确认转换是否正确）
        // console.log("转换后feedType:", finalFeedType, "时长(秒):", ad_duration_seconds);

        // 核心判断逻辑（明确：非视频类型 或 时长>60秒 则跳过）
        const spscValue = process.env['spsc'] !== undefined ? Number(process.env['spsc']) : 60;
        if (finalFeedType !== 0 || ad_duration_seconds > spscValue) {
            console.log(`[${this.accountTag}] \x1b[91m ${taskConfig.name} 检测到（长时间或非视频 类型：${finalFeedType === 0 ? '视频' : '其他'}）广告 (${ad_duration_seconds.toFixed(2)}秒)，已跳过\x1b[0m`);
            return null;
        }
        // console.log("广告详情：",response.feeds[0]['ad']['adDataV2']['inspireAdInfo'])
        const adExtInfo = response.feeds[0]['ad']['adDataV2']['inspireAdInfo']['adExtInfo'] || '{}';
        const neoValue =  response.feeds[0]['ad']['adDataV2']['inspireAdInfo']['inspirePersonalize']['neoValue'];
       

        console.log(
        `${this.accountTag} ${taskConfig.name}：` + 
        `\x1b[34m${ 
            // 截取前6个字符，超出则加...
            response.feeds[0].caption.length > 6 
            ? response.feeds[0].caption.substring(0, 6) + '...' 
            : response.feeds[0].caption 
        }\x1b[0m ` +  // 蓝色文本（只显示前6字）
        `预计：\x1b[31m${neoValue}\x1b[0m 金币`          // 红色文本
        );
        // 校验响应格式
        if (!response.feeds || !response.feeds[0] || !response.feeds[0].ad) {
          console.log(`${this.accountTag} ${taskConfig.name}响应数据格式错误`);
          if (RequestClient.isDevMode()) {
            console.log("详细响应:", JSON.stringify(response, null, 2));
          }
          return null;
        }

        // 提取广告关键信息
        const llsid = response.feeds[0].exp_tag.split("/")[1].split("_")[0];
        return {
          cid: response.feeds[0].ad.creativeId,
          llsid: llsid,
          mediaScene: "video",
          materialTime: materialTime,
          adExtInfo: adExtInfo
        };
      } else {
        console.log(`${this.accountTag} ${taskConfig.name}接口返回错误`);
        if (response.errorMsg) console.log(`错误信息: ${response.errorMsg}`);
        if (response.errorCode) console.log(`错误代码: ${response.errorCode}`);
        if (RequestClient.isDevMode()) {
          console.log("完整响应:", JSON.stringify(response, null, 2));
        }
        return null;
      }
    } catch (error) {
      console.log(`${this.accountTag} 获取${taskConfig.name}信息异常: ${error.message}`);
      if (RequestClient.isDevMode() && error.stack) {
        console.log(`错误堆栈: ${error.stack.split("\n").slice(1, 4).join("\n")}`);
      }
      return null;
    }
  }

  /**
   * 构建设备参数（用于广告请求）
   * @returns {Object} 设备参数对象
   */
  _buildDeviceParams() {
    return {
      earphoneMode: "1",
      mod: "Xiaomi(23116PN5BC)",
      appver: this.appver,
      isp: "CUCC",
      language: "zh-cn",
      ud: this.userId,
      did_tag: "0",
      thermal: "10000",
      net: "WIFI",
      kcv: "1599",
      app: "0",
      kpf: "ANDROID_PHONE",
      bottom_navigation: "true",
      ver: "11.6",
      android_os: "0",
      boardPlatform: "pineapple",
      kpn: "NEBULA",
      newOc: "VIVO",
      androidApiLevel: "35",
      slh: "0",
      country_code: "cn",
      nbh: "0",
      hotfix_ver: "",
      did_gt: "1754845543387",
      keyconfig_state: "2",
      cdid_tag: "2",
      sys: this.sys,
      max_memory: "256",
      oc: "VIVO",
      sh: "2400",
      deviceBit: "0",
      browseType: "3",
      ddpi: "410",
      socName: "Qualcomm Snapdragon 8650",
      is_background: "0",
      c: "VIVO",
      sw: "1080",
      ftt: "",
      apptype: "22",
      abi: "arm64",
      userRecoBit: "0",
      device_abi: "arm64",
      totalMemory: "15160",
      grant_browse_type: "AUTHORIZED",
      iuid: "",
      sbh: "110",
      darkMode: "false"
    };
  }

  /**
   * 构建广告请求参数（impInfo等核心参数）
   * @param {Object} taskConfig - 任务配置
   * @returns {Object} 广告请求参数
   */
  _buildAdRequestParams(taskConfig) {
    let impExtData;
    
    // 从环境变量读取搜索关键词，支持多个词用逗号分隔
    let searchKeywords = [];
    const envKeywords = process.env.ssggc || "短剧小说";
    searchKeywords = envKeywords.split(',').map(keyword => keyword.trim()).filter(keyword => keyword);
    
    // 如果分割后没有有效的关键词，使用默认关键词
    if (searchKeywords.length === 0) {
      searchKeywords = ["短剧小说"];
    }
    
    // 随机选择一个搜索关键词
    const randomKeyword = searchKeywords[Math.floor(Math.random() * searchKeywords.length)];
    
    // 对于搜索广告类型的任务（包括普通搜索广告和追加搜索广告），使用解码后的neoParams结构
    if (taskConfig.name === "搜索广告" || taskConfig.name === "搜索广告[追加]") {
      // 解码后的neoParams明文对象
      const neoParamsObj = {
        "pageId": 11101,
        "subPageId": 100074584,
        "posId": 96134,
        "businessId": 7038,
        "extParams": "4bbb1b590bd5b0a076e53168918c0d95cc3b96656eb0ef6bb4f9b880d793ce8f9c00509aeb71de0e7cfd6ac6cc02172547e5e134ffacc8e49d93bab38e7bc4b7b2e0f620019c7587f2d3c38aeabd632d7bcf07c56cb8059644be9d217937f37c",
        "customData": {
          "exitInfo": {
            "toastDesc": null,
            "toastImgUrl": null
          }
        },
        "pendantType": 1,
        "displayType": 2,
        "singlePageId": 0,
        "singleSubPageId": 0,
        "channel": 0,
        "countdownReport": true,
        "themeType": 0,
        "mixedAd": true,
        "fullMixed": true,
        "autoReport": true,
        "fromTaskCenter": true,
        "searchInspireSchemeInfo": {
          "searchQuery": randomKeyword,
          "searchSessionId": "MTc1NzM1NTM3ODcxNF9jbG91ZC0yMjY0MTc1LTEyMjE4NjYtMTA4NDc5Ny0yMDAtZGVwbG95LTg1OGI5NzVmNDYtbDlzYmxf5YmnXzAuMDE0MDM1MzAwNjQ3MDc4MDM=",
          "enterSource": "ACT_renwu_ad_box_single_col"
        },
        "amount": 2500
      };

      // 将neoParams对象转换为单行JSON字符串并进行Base64编码
      const neoParamsStr = JSON.stringify(neoParamsObj);
      const neoParamsBase64 = Buffer.from(neoParamsStr).toString('base64');
      
      // 构建完整的impExtData
      impExtData = JSON.stringify({
        "openH5AdCount": 2,
        "sessionLookedCompletedCount": "1",
        "sessionType": "1",
        "searchKey": randomKeyword,
        "triggerType": "2",
        "disableReportToast": "true",
        "businessEnterAction": "7",
        "neoParams": neoParamsBase64
      });
    } else {
      const neoParamsObj = {
        "pageId": 11101,
        "subPageId": taskConfig.subPageId,
        "posId": taskConfig.posId,
        "businessId": taskConfig.businessId,
        "extParams": "7137208a74c0c690cfd59e94b853775290f87853de32564d735eb9ef21f53414800f5e3db2364f3581abcc779c210d47ba762554c8ab02b0d5be753ec7e78262498dbccb05d00223029225ba0b1483475c292daa06857d83631c6001cc1d73a3",
        "customData": {
          "exitInfo": {
            "toastDesc": null,
            "toastImgUrl": null
          }
        },
        "pendantType": 1,
        "displayType": 2,
        "singlePageId": 0,
        "singleSubPageId": 0,
        "channel": 0,
        "countdownReport": false,
        "themeType": 0,
        "mixedAd": false,
        "fullMixed": false,
        "autoReport": true,
        "fromTaskCenter": false,
        "amount": 0
      };

      // 将neoParams对象转换为单行JSON字符串并进行Base64编码
      const neoParamsStr = JSON.stringify(neoParamsObj);
      const neoParamsBase64 = Buffer.from(neoParamsStr).toString('base64');
      
      // 非搜索广告类型使用默认的impExtData
      impExtData = JSON.stringify({
        "openH5AdCount": 2,
        "sessionLookedCompletedCount": "1",
        "sessionType": "1",
        "triggerType": "2",
        "searchKey": '',
        "disableReportToast": "true",
        "businessEnterAction": "7",
        "neoParams": neoParamsBase64
      });
    }
    
    return {
      appInfo: {
        appId: "kuaishou_nebula",
        name: CONSTANTS.APP_NAME,
        packageName: "com.kuaishou.nebula",
        version: this.appver,
        versionCode: -1
      },
      deviceInfo: {
        oaid: "",
        osType: 1,
        osVersion: "15",
        language: "zh",
        deviceId: this.did,
        screenSize: { width: 1080, height: 2249 },
        ftt: ""
      },
      networkInfo: {
        ip: "192.168.1.43",
        connectionType: 100
      },
      geoInfo: { latitude: 0, longitude: 0 },
      userInfo: { userId: this.userId, age: 0, gender: "" },
      impInfo: [{
        pageId: 11101,
        subPageId: taskConfig.subPageId,
        action: 0,
        width: 0,
        height: 0,
        browseType: 3,
        impExtData: impExtData,
        mediaExtData: "{}"
      }]
    };
  }

  /**
   * 提交任务报告（领取奖励）
   * @param {string} sig - 签名1
   * @param {string} sig3 - 签名3
   * @param {string} sigToken - Token签名
   * @param {string} postData - POST数据
   * @param {string} taskKey - 任务类型键
   * @param {Object} taskConfig - 任务配置
   * @returns {Promise<Object>} 提交结果（{success: boolean, reward: number}）
   */
  async _submitReport(sig, sig3, sigToken, postData, taskKey, taskConfig) {
    try {
      // 构建请求配置
      const requestOptions = {
        method: "post",
        url: `${CONSTANTS.API_BASE_URL}/rest/r/ad/task/report?${this.query}&sig=${sig}&__NS_sig3=${sig3}&__NS_xfalcon=&__NStokensig=${sigToken}`,
        headers: {
          "Host": "api.e.kuaishou.com",
          "User-Agent": CONSTANTS.ANDROID_USER_AGENT,
          "Cookie": this.cookie,
          "Content-Type": "application/x-www-form-urlencoded",
          "kaw": this.kaw || "MDHkM+9FrbzBSEAqyw6KYGqGa3b3Y2gIZq3YJZrGkTfaYzm10bLlDdGjxtTP/Vsn9qY6EtUMxCHt4jSsI+tFr9Ghm+r+KqHlnsOvBH0tCt4Ooik1wJGFzJpMJlsk/JeN79ww0w+eSy/M9oLfga/mji6Accpfu1wNXI1lYVZ3blsdkEud+hPR1c9Qj/CgplRmsM+Tmu37HcBisfMQFIszemGwXI2U+aRzBNCli/sJt3/RWyBFmtkwDIFoTyTZoMd0+TUA",
          "kas": this.kas || "0016df70b7d4e188b70eea1ecf158ad175",
        },
        body: postData
      };

      // 发起请求
      const response = await RequestClient.makeRequest(requestOptions, this.proxyConfig);
      if (!response) {
        console.log(`${this.accountTag} 提交${taskConfig.name}报告失败，无响应`);
        return { success: false, reward: 0 };
      }
      
      // 处理提交结果
      if (response.result === 1) {
        const reward = response.data.neoAmount || 0;
        // 更新累计金币
        this.totalRewards += reward;
        console.log(
          `${this.accountTag} ${taskConfig.name}获得\x1b[33m${reward}\x1b[0m 金币奖励！当前已累计获得\x1b[33m${this.totalRewards}\x1b[0m 金币`
        );
        return { success: true, reward: reward };
      } 
      // 任务达上限（结果码415/1003）
      else if (response.result === 415 || response.result === 1003) {
        console.log(`${this.accountTag} ${taskConfig.name}奖励失败，此任务已达上限`);
        this.taskLimitReached[taskKey] = true;
        console.log(`${this.accountTag} 跳过${taskConfig.name}任务`);
        return { success: false, reward: 0 };
      } 
      // 其他失败情况
      else {
        console.log(`${this.accountTag} ${taskConfig.name}奖励失败，多次失败请先手动点击${taskConfig.name}的广告是否正常`);
        if (response.result !== undefined) console.log(`返回结果码: ${response.result}`);
        if (response.errorMsg) console.log(`错误信息: ${response.errorMsg}`);
        if (response.errorCode) console.log(`错误代码: ${response.errorCode}`);
        if (response.data) console.log(`返回数据: ${JSON.stringify(response.data, null, 2)}`);
        if (RequestClient.isDevMode()) {
          console.log("请求配置:", JSON.stringify(requestOptions, null, 2));
          console.log("完整响应:", JSON.stringify(response, null, 2));
        }
        return { success: false, reward: 0 };
      }
    } catch (error) {
      console.log(`${this.accountTag} 提交${taskConfig.name}报告异常: ${error.message}`);
      if (RequestClient.isDevMode() && error.stack) {
        console.log(`错误堆栈: ${error.stack.split("\n").slice(1, 4).join("\n")}`);
      }
      return { success: false, reward: 0 };
    }
  }

  /**
   * 执行搜索任务（特殊处理）
   * @param {Object} adInfo - 广告信息
   * @param {Object} taskConfig - 任务配置
   * @returns {Promise<boolean>} 任务是否执行成功
   */
  async _executeSearchTask(adInfo, taskConfig) {
    try {
      // 生成签名
      const signature = await this._retryOperation(
        () => this._generateSignature(adInfo.cid, adInfo.llsid, 'seek', taskConfig),
        `生成${taskConfig.name}签名`,
        10
      );
      if (!signature) {
        console.log(`${this.accountTag} 生成${taskConfig.name}签名失败`);
        return false;
      }

      // 构建特殊的bizStr参数
      const bizStr = `bizStr={"businessId":${taskConfig.businessId},"endTime":${Date.now()-25000},"extParams":"","mediaScene":"video","neoInfos":[{"creativeId":${adInfo.cid},"extInfo":"","llsid":${adInfo.llsid},"requestSceneType":1,"taskType":1,"watchExpId":"","watchStage":0}],"pageId":11101,"posId":${taskConfig.posId},"reportType":0,"sessionId":"","startTime":${Date.now()},"subPageId":${taskConfig.subPageId}}&cs=false&client_key=2ac2a76d`;

      // 构建请求配置（添加search任务特有的请求头）
      const requestOpts = {
        method: "post",
        url: `${CONSTANTS.API_BASE_URL}/rest/e/reward/task/report?sig=${signature.sig}&__NS_sig3=${signature.sig3}&__NS_xfalcon=&__NStokensig=${signature.sigtoken}`,
        headers: {
          "Host": "api.e.kuaishou.com",
          "Connection": "keep-alive",
          "User-Agent": CONSTANTS.ANDROID_USER_AGENT,
          "Cookie": `kuaishou_api_st=${this.kuaishouApiSt}`,
          "page-code": "NEW_TASK_CENTER",
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Client-Info": "model=V2049A;os=Android;nqe-score=33;network=WIFI;"
        },
        body: bizStr
      };

      // 发送请求
      const response = await RequestClient.makeRequest(requestOpts, this.proxyConfig);
      if (!response) {
        console.log(`${this.accountTag} ${taskConfig.name}提交报告失败，无响应`);
        return false;
      }
      
      // 处理提交结果
      if (response.result === 1) {
        const reward = response.data.neoAmount || 0;
        console.log(`${this.accountTag} ${taskConfig.name}完成，获得${reward}金币奖励！`);
        // 调试日志：显示完整返回值
        console.log(`${this.accountTag} ${taskConfig.name}返回值详情:`);
        console.log(JSON.stringify(response, null, 2));
        
        // 防黑号延迟（模拟10-28极速.js中的机制）
        const antiBlockDelay = Math.floor(5001 * Math.random()) + 5000;
        console.log(`${this.accountTag} 防黑号延迟：${Math.round(antiBlockDelay/1000)}秒`);
        await new Promise(resolve => setTimeout(resolve, antiBlockDelay));
        
        return true;
      } 
      // 任务达上限（结果码415/1003）
      else if (response.result === 415 || response.result === 1003) {
        console.log(`${this.accountTag} ${taskConfig.name}奖励失败，此任务已达上限`);
        this.taskLimitReached['seek'] = true;
        console.log(`${this.accountTag} 跳过${taskConfig.name}任务`);
        return false;
      } 
      // 其他失败情况
      else {
        const errMsg = response.message || response.error_msg || "未知错误";
        console.log(`${this.accountTag} ${taskConfig.name}失败：${errMsg}`);
        if (response.result !== undefined) console.log(`返回结果码: ${response.result}`);
        if (RequestClient.isDevMode()) {
          console.log("请求配置:", JSON.stringify(requestOpts, null, 2));
          console.log("完整响应:", JSON.stringify(response, null, 2));
        }
        return false;
      }
    } catch (error) {
      console.log(`${this.accountTag} ${taskConfig.name}执行异常: ${error.message}`);
      if (RequestClient.isDevMode() && error.stack) {
        console.log(`错误堆栈: ${error.stack.split("\n").slice(1, 4).join("\n")}`);
      }
      return false;
    }
  }

  /**
   * 执行单个任务（基础版）
   * @param {string} taskKey - 任务类型键（box/look/food/seek）
   * @returns {Promise<boolean>} 任务是否执行成功
   */
  async executeTask(taskKey) {
    const taskConfig = this.taskConfigs[taskKey];
    if (!taskConfig) {
      console.log(`${this.accountTag} 未知任务类型: ${taskKey}`);
      return false;
    }
    if (this.taskLimitReached[taskKey]) return false;

    try {
      // 1. 获取广告信息
      const adInfo = await this._retryOperation(
        () => this._getAdInfo(taskConfig),
        `获取${taskConfig.name}信息`,
        CONSTANTS.MAX_RETRY_COUNT
      );
      if (!adInfo) {
        console.log(`${this.accountTag} 获取${taskConfig.name}信息失败`);
        this.taskStats[taskKey].failed++;
        return false;
      }

      // 特殊处理搜索任务
      if (taskKey === 'seek') {
        const success = await this._executeSearchTask(adInfo, taskConfig);
        if (success) {
          this.taskStats[taskKey].success++;
        } else {
          this.taskStats[taskKey].failed++;
        }
        return success;
      }

      // 2. 随机延迟（模拟用户观看） - 非搜索任务
      const delay = Toolkit.getRandomDelay();
      await new Promise(resolve => setTimeout(resolve, delay));

      // 3. 生成签名
      const signature = await this._retryOperation(
        () => this._generateSignature(adInfo.cid, adInfo.llsid, taskKey, taskConfig),
        `生成${taskConfig.name}签名`,
        10
      );
      if (!signature) {
        console.log(`${this.accountTag} 生成${taskConfig.name}签名失败`);
        this.taskStats[taskKey].failed++;
        return false;
      }

      // 4. 提交任务报告
      const submitResult = await this._retryOperation(
        () => this._submitReport(signature.sig, signature.sig3, signature.sigtoken, signature.post, taskKey, taskConfig),
        `提交${taskConfig.name}报告`,
        CONSTANTS.MAX_RETRY_COUNT
      );

      // 5. 更新任务状态
      if (submitResult.success) {
        this.taskStats[taskKey].success++;
        this.taskStats[taskKey].totalReward += submitResult.reward || 0;
        // 检查低奖励连续次数
        if ((submitResult.reward || 0) <= this.lowRewardThreshold) {
          this.lowRewardStreak++;
          if (this.lowRewardStreak >= this.lowRewardLimit) {
            console.log(`${this.accountTag} 连续${this.lowRewardLimit}次奖励≤${this.lowRewardThreshold}金币，停止该账号所有任务`);
            this.stopAllTasks = true;
          }
        } else {
          this.lowRewardStreak = 0;
        }
      } else {
        this.taskStats[taskKey].failed++;
      }

      return submitResult.success;
    } catch (error) {
      console.log(`${this.accountTag} ${taskConfig.name}任务执行失败: ${error.message}`);
      this.taskStats[taskKey].failed++;
      return false;
    }
  }

  /**
   * 执行单个任务（智能版：根据成功率调整重试/延迟）
   * @param {string} taskKey - 任务类型键（box/look/food）
   * @returns {Promise<boolean>} 任务是否执行成功
   */
  async executeTaskSmart(taskKey) {
    const taskConfig = this.taskConfigs[taskKey];
    if (!taskConfig) {
      console.log(`${this.accountTag} 未知任务类型: ${taskKey}`);
      return false;
    }
    if (this.taskLimitReached[taskKey]) return false;

    // 计算任务成功率，动态调整重试次数
    const taskStats = this.taskStats[taskKey];
    const totalExecutions = taskStats.success + taskStats.failed;
    const successRate = totalExecutions > 0 ? taskStats.success / totalExecutions : 1;
    let retryCount = 5;
    if (successRate < 0.3) retryCount = 3;    // 低成功率：减少重试
    else if (successRate > 0.8) retryCount = 8; // 高成功率：增加重试

    try {
      // 1. 获取广告信息（动态重试次数）
      const adInfo = await this._retryOperation(
        () => this._getAdInfo(taskConfig),
        `获取${taskConfig.name}信息`,
        retryCount
      );
      if (!adInfo) {
        console.log(`${this.accountTag} 获取${taskConfig.name}信息失败`);
        this.taskStats[taskKey].failed++;
        return false;
      }

      // 2. 动态延迟（低成功率延长延迟，高成功率缩短延迟）
      let delay = Toolkit.getRandomDelay();
      if (successRate < 0.5) delay = Math.floor(delay * 1.5);
      else if (successRate > 0.9) delay = Math.floor(delay * 0.8);
      console.log(`${this.accountTag} 开始${taskConfig.name} 模拟真实互动 `);
      await new Promise(resolve => setTimeout(resolve, delay));

      // 3. 生成签名（动态重试次数：最多15次）
      const signature = await this._retryOperation(
        () => this._generateSignature(adInfo.cid, adInfo.llsid, taskKey, taskConfig),
        `生成${taskConfig.name}签名`,
        Math.min(retryCount + 5, 15)
      );
      if (!signature) {
        console.log(`${this.accountTag} 生成${taskConfig.name}签名失败`);
        this.taskStats[taskKey].failed++;
        return false;
      }

      // 4. 提交任务报告
      const submitResult = await this._retryOperation(
        () => this._submitReport(signature.sig, signature.sig3, signature.sigtoken, signature.post, taskKey, taskConfig),
        `提交${taskConfig.name}报告`,
        retryCount
      );

      // 5. 更新任务状态
      if (submitResult.success) {
        this.taskStats[taskKey].success++;
        this.taskStats[taskKey].totalReward += submitResult.reward || 0;
        if ((submitResult.reward || 0) <= this.lowRewardThreshold) {
          this.lowRewardStreak++;
          if (this.lowRewardStreak >= this.lowRewardLimit) {
            console.log(`${this.accountTag} 连续${this.lowRewardLimit}次奖励≤${this.lowRewardThreshold}金币，停止该账号所有任务`);
            this.stopAllTasks = true;
          }
        } else {
          this.lowRewardStreak = 0;
        }
      } else {
        this.taskStats[taskKey].failed++;
      }

      return submitResult.success;
    } catch (error) {
      console.log(`${this.accountTag} ${taskConfig.name}任务执行失败: ${error.message}`);
      this.taskStats[taskKey].failed++;
      return false;
    }
  }

  /**
   * 计算任务优先级（成功率60%权重 + 平均奖励40%权重）
   * @param {string} taskKey - 任务类型键
   * @returns {number} 优先级分数（0-1）
   */
  _getTaskPriority(taskKey) {
    const taskStats = this.taskStats[taskKey];
    const totalExecutions = taskStats.success + taskStats.failed;
    const successRate = totalExecutions > 0 ? taskStats.success / totalExecutions : 0.5;
    const avgReward = taskStats.success > 0 ? taskStats.totalReward / taskStats.success : 0;
    
    // 成功率占60%权重，平均奖励（归一化到0-1）占40%权重
    return successRate * 0.6 + Math.min(avgReward / 100, 1) * 0.4;
  }

  /**
   * 获取任务执行顺序（按优先级排序，高优先级先执行）
   * @returns {Array<string>} 任务类型键数组（排序后）
   */
  getTaskExecutionOrder() {
    const taskKeys = Object.keys(this.taskConfigs);
    if (taskKeys.length === 0) return [];

    // 按优先级降序排序
    return taskKeys.sort((a, b) => {
      const priorityA = this._getTaskPriority(a);
      const priorityB = this._getTaskPriority(b);
      return priorityB - priorityA;
    });
  }

  /**
   * 按优先级执行所有任务
   * @returns {Promise<Object>} 任务执行结果（{taskKey: successStatus}）
   */
  async executeAllTasksByPriority() {
    const taskOrder = this.getTaskExecutionOrder();
    if (taskOrder.length === 0) {
      console.log(`${this.accountTag} 未启用任何任务，跳过执行`);
      return {};
    }

    // 打印任务执行顺序
    const taskNames = taskOrder.map(key => this.taskConfigs[key].name || key);
    console.log(`${this.accountTag} 任务执行顺序: ${taskNames.join(" -> ")}`);

    const executionResult = {};
    if (this.stopAllTasks) {
      console.log(`${this.accountTag} 已被标记停止，跳过所有任务`);
      return executionResult;
    }

    // 按顺序执行任务
    for (let i = 0; i < taskOrder.length; i++) {
      const taskKey = taskOrder[i];
      const taskConfig = this.taskConfigs[taskKey];

      // 跳过已达上限的任务
      if (this.taskLimitReached[taskKey]) {
        executionResult[taskKey] = false;
        continue;
      }

      console.log(`${this.accountTag} 开始执行${taskConfig.name}任务...`);
      const taskSuccess = await this.executeTaskSmart(taskKey);
      executionResult[taskKey] = taskSuccess;

      // 检查是否需要停止所有任务
      if (this.stopAllTasks) {
        console.log(`${this.accountTag} 已被标记停止，终止剩余任务`);
        break;
      }

      // 非最后一个任务，执行后延迟
      if (i !== taskOrder.length - 1) {
        const delay = Math.floor(2000 * Math.random()) + 3000;
        console.log(`${this.accountTag} 等待 ${Math.round(delay / 1000)} 秒后执行下一个任务...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return executionResult;
  }

  /**
   * 获取账号基本信息（金币、余额、昵称等）
   * @returns {Promise<Object>} 基本信息结果（{success: boolean, data?: Object}）
   */
  async getAccountBasicInfo() {
    try {
      const requestOptions = {
        method: "get",
        url: "https://nebula.kuaishou.com/rest/n/nebula/activity/earn/overview/basicInfo?source=bottom_guide_first",
        headers: {
          "Host": "nebula.kuaishou.com",
          "User-Agent": CONSTANTS.ANDROID_USER_AGENT,
          "Cookie": this.cookie,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      };

      const response = await RequestClient.makeRequest(requestOptions, this.proxyConfig);
      if (!response) {
        console.log(`${this.accountTag} 获取账号基本信息失败，无响应`);
        return { success: false };
      }

      if (response.result === 1) {
        // 保持使用环境变量中的备注信息，不再更新为昵称
        return {
          success: true,
          data: {
            totalCash: response.data.totalCash,
            totalCoin: response.data.totalCoin,
            allCash: response.data.allCash,
            userData: response.data.userData
          }
        };
      } else {
        console.log(`${this.accountTag} 获取账号基本信息失败`);
        return { success: false };
      }
    } catch (error) {
      console.log(`${this.accountTag} 获取账号基本信息异常: ${error.message}`);
      if (RequestClient.isDevMode() && error.stack) {
        console.log(`错误堆栈: ${error.stack.split("\n").slice(1, 4).join("\n")}`);
      }
      return { success: false };
    }
  }

  /**
   * 上报用户信息到统计服务
   * @param {Object} userInfo - 用户信息
   * @returns {Promise<Object>} 上报结果
   */
  async reportUserInfo(userInfo) {
    try {
      const cardKey = Toolkit.getEnv("km")[0];
      const requestOptions = {
        method: "post",
        url: `${CONSTANTS.VERSION_CHECK_URL}${CONSTANTS.USER_INFO_COLLECT_PATH}`,
        headers: {
          "Content-Type": "application/json",
          ...(cardKey ? { "X-Card-Key": cardKey } : {})
        },
        body: JSON.stringify(userInfo)
      };

      await RequestClient.makeRequest(requestOptions);
      return { success: true };
    } catch (error) {
      console.log(`${this.accountTag} 用户信息上报异常: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取任务统计数据
   * @returns {Object} 任务统计（{taskKey: {success, failed, totalReward}}）
   */
  getTaskStats() {
    return JSON.parse(JSON.stringify(this.taskStats)); // 深拷贝避免外部修改
  }

  /**
   * 打印任务统计日志
   */
  printTaskStats() {
    console.log(`${this.accountTag} 任务执行统计:`);
    Object.entries(this.taskStats).forEach(([taskKey, stats]) => {
      const taskName = this.taskConfigs[taskKey].name || taskKey;
      console.log(`  ${taskName}: 成功${stats.success}次, 失败${stats.failed}次, 总奖励${stats.totalReward}金币`);
    });
  }

  // 快捷任务执行方法（兼容原API）
  async executeFoodTask() { return this.executeTask("food"); }
  async executeBoxTask() { return this.executeTask("box"); }
  async executeLookAdTask() { return this.executeTask("look"); }
  async executeFoodTaskSmart() { return this.executeTaskSmart("food"); }
  async executeBoxTaskSmart() { return this.executeTaskSmart("box"); }
  async executeLookAdTaskSmart() { return this.executeTaskSmart("look"); }
}

// 6. 账号任务管理器：多账号并发执行、任务调度
class AccountTaskManager {
  /**
   * 初始化账号配置（适配青龙面板的 & 分隔）
   * @param {Array<string>} ksckValues - 环境变量值数组（每个元素是 salt#cookie[#proxy]）
   * @param {number} minCoinThreshold - 金币阈值
   * @returns {Array<Object>} 账号配置数组
   */
  static initAccountConfigs(ksckValues, minCoinThreshold) {
    const accountConfigs = [];
    if (!ksckValues || !ksckValues.length) return accountConfigs;

    let accountIndex = 0;

    for (const line of ksckValues) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // 解析账号格式：备注#ck#salt[#kaw[#kas[#proxyConfig]]]
      const parts = trimmedLine.split("#");
      if (parts.length < 3) {
        console.log(`账号格式错误，跳过: ${trimmedLine}`);
        continue;
      }

      accountIndex++;
      const remark = parts[0];
      const cookie = parts[1];
      const salt = parts[2];
      let kaw = null;
      let kas = null;
      let proxyStr = null;

      // 处理带kaw、kas和代理的情况
      if (parts.length >= 6) {
        // 完整格式：备注#ck#salt#kaw#kas#代理
        kaw = parts[3];
        kas = parts[4];
        proxyStr = parts.slice(5).join("#"); // 代理配置中可能包含#，需合并
      } else if (parts.length >= 4) {
        // 简化格式：备注#ck#salt#代理
        proxyStr = parts.slice(3).join("#"); // 代理配置中可能包含#，需合并
      }

      // 解析代理配置
      let proxyConfig = null;
      if (proxyStr && proxyStr.trim()) {
        proxyConfig = Toolkit.parseProxyConfig(proxyStr.trim());
        if (proxyConfig) {
          console.log(`${remark} 配置代理: ${proxyConfig.host}:${proxyConfig.port}`);
        } else {
          console.log(`${remark} 代理配置解析失败: ${proxyStr}`);
        }
      }

      // 添加账号配置，包含金币阈值、备注、kaw和kas
      accountConfigs.push({
        index: accountIndex,
        remark: remark,
        salt: salt,
        cookie: cookie,
        kaw: kaw,
        kas: kas,
        proxyConfig: proxyConfig,
        minCoinThreshold: minCoinThreshold
      });
    }

    console.log(`共找到${accountConfigs.length}个有效账号`);
    return accountConfigs;
  }

  /**
   * 单账号任务执行（含初始化、多轮任务）
   * @param {Object} accountConfig - 账号配置
   * @param {number} roundCount - 任务轮次
   * @returns {Promise<Object>} 执行结果
   */
  static async runSingleAccountTask(accountConfig, roundCount = 10) {
    const { index, salt, cookie, proxyConfig, remark } = accountConfig;
    // 初始账号标识：包含序号和备注
    let accountTag = `账号${index}[${remark || '未获取备注'}]`;
    let initialCoins = 0;
    let initialBalance = 0;

    try {
      // 1. 初始化账号任务实例
      const taskWorker = new KuaishouAdTaskWorker({
        index,
        salt,
        cookie,
        proxyConfig,
        remark: accountConfig.remark,
        minCoinThreshold: accountConfig.minCoinThreshold
      });

      // 2. 获取账号基本信息（补充初始金币余额，保持使用备注作为标识）
      const basicInfoResult = await taskWorker.getAccountBasicInfo();
      if (basicInfoResult.success) {
        initialCoins = basicInfoResult.data.totalCoin || 0;
        initialBalance = basicInfoResult.data.allCash || 0;
        console.log(`${accountTag} 初始金币: ${initialCoins} 初始余额: ${initialBalance}`);
        
        // 检查初始金币是否达到阈值
        if (initialCoins >= taskWorker.minCoinThreshold) {
          console.log(`${accountTag} 初始金币(${initialCoins})已达到或超过阈值(${taskWorker.minCoinThreshold})，停止所有任务流程`);
          return {
            success: true,
            accountIndex: index,
            accountTag: accountTag,
            stats: taskWorker.getTaskStats(),
            initialCoins: initialCoins,
            initialBalance: initialBalance,
            finalCoins: initialCoins,
            finalBalance: initialBalance,
            message: "初始金币达到阈值，未执行任务"
          };
        }
      } else {
        console.log(`${accountTag} 无法获取账号基本信息，可能影响金币阈值判断`);
      }

      console.log(`${accountTag} 线程启动，开始执行任务（共${roundCount}轮）`);

      // 3. 执行多轮任务
      for (let round = 0; round < roundCount; round++) {
        if (taskWorker.stopAllTasks) break;

        let roundSuccess = false;
        let retryCount = 0;

        // 单轮任务重试（最多CONSTANTS.MAX_TASK_RETRY次）
        while (!roundSuccess && retryCount < CONSTANTS.MAX_TASK_RETRY) {
          try {
            const delay = Toolkit.getRandomDelay();
            const retryTag = retryCount > 0 ? `(重试${retryCount}/${CONSTANTS.MAX_TASK_RETRY})` : "";
            console.log(`${accountTag} 第${round + 1}轮任务${retryTag}，随机延迟 ${Math.round(delay / 1000)} 秒`);
            await new Promise(resolve => setTimeout(resolve, delay));

            // 按优先级执行所有任务
            const executionResult = await taskWorker.executeAllTasksByPriority();
            const hasSuccessTask = Object.values(executionResult).some(Boolean);

            // 检查轮次是否成功（至少一个任务成功）
            if (Object.keys(executionResult).length === 0) {
              console.log(`${accountTag} 未启用任何任务，跳过该轮`);
              roundSuccess = true;
              break;
            }

            if (hasSuccessTask) {
              console.log(`${accountTag} 第${round + 1}轮任务执行成功`);
              roundSuccess = true;
            } else {
              retryCount++;
              if (retryCount < CONSTANTS.MAX_TASK_RETRY) {
                const retryDelay = Math.floor(3000 * Math.random()) + 10000;
                console.log(`${accountTag} 第${round + 1}轮任务执行失败，${CONSTANTS.MAX_TASK_RETRY - retryCount}次重试机会剩余`);
                console.log(`${accountTag} 等待 ${Math.round(retryDelay / 1000)} 秒后重试...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
              } else {
                console.log(`${accountTag} 第${round + 1}轮任务执行失败，已达到最大重试次数(${CONSTANTS.MAX_TASK_RETRY})`);
              }
            }
          } catch (error) {
            retryCount++;
            console.log(`${accountTag} 第${round + 1}轮任务执行异常: ${error.message}`);

            if (taskWorker.stopAllTasks) {
              console.log(`${accountTag} 连续低奖励已触发停止，结束该账号所有任务`);
              break;
            }

            if (retryCount < CONSTANTS.MAX_TASK_RETRY) {
              const retryDelay = Math.floor(5000 * Math.random()) + 10000;
              console.log(`${accountTag} 还有${CONSTANTS.MAX_TASK_RETRY - retryCount}次重试机会`);
              console.log(`${accountTag} 等待 ${Math.round(retryDelay / 1000)} 秒后重试...`);
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
              console.log(`${accountTag} 第${round + 1}轮任务执行失败，已达到最大重试次数(${CONSTANTS.MAX_TASK_RETRY})`);
            }
          }
        }

        // 轮次间延迟（非最后一轮）
        if (round < roundCount - 1 && !taskWorker.stopAllTasks) {
          const intervalDelay = Math.floor(5000 * Math.random()) + 10000;
          console.log(`${accountTag} 等待 ${Math.round(intervalDelay / 1000)} 秒后开始下一轮`);
          await new Promise(resolve => setTimeout(resolve, intervalDelay));
        }
      }

      // 4. 任务完成后获取最终金币和余额
      const finalInfoResult = await taskWorker.getAccountBasicInfo();
      let finalCoins = 0;
      let finalBalance = 0;
      
      if (finalInfoResult.success) {
        finalCoins = finalInfoResult.data.totalCoin || 0;
        finalBalance = finalInfoResult.data.allCash || 0;
        console.log(`${accountTag} 最终金币: ${finalCoins} 最终余额: ${finalBalance}`);
      } else {
        console.log(`${accountTag} 无法获取最终金币和余额信息`);
      }

      // 打印账号任务统计
      taskWorker.printTaskStats();
      console.log(`${accountTag} 所有任务执行完成`);

      return {
        success: true,
        accountIndex: index,
        accountTag: accountTag,
        stats: taskWorker.getTaskStats(),
        initialCoins: initialCoins,
        initialBalance: initialBalance,
        finalCoins: finalCoins,
        finalBalance: finalBalance
      };
    } catch (error) {
      console.log(`${accountTag} 任务执行异常: ${error.message}`);
      return {
        success: false,
        accountIndex: index,
        accountTag: accountTag,
        error: error.message,
        initialCoins: initialCoins,
        initialBalance: initialBalance,
        finalCoins: 0,
        finalBalance: 0
      };
    }
  }

  /**
   * 多账号并发执行任务
   * @param {Array<Object>} accountConfigs - 账号配置数组
   * @param {number} roundCount - 任务轮次
   * @param {number} maxConcurrency - 最大并发数
   * @returns {Promise<Array<Object>>} 所有账号执行结果
   */
  static async runConcurrentAccountTasks(accountConfigs, roundCount = 10, maxConcurrency = CONSTANTS.ksjsb_xc) {
    const results = new Array(accountConfigs.length);
    let currentIndex = 0;
    const concurrencyLimit = Math.min(maxConcurrency, accountConfigs.length);

    // 并发执行函数
    const executeAccountTask = async () => {
      while (currentIndex < accountConfigs.length) {
        const index = currentIndex++;
        const config = accountConfigs[index];
        try {
          results[index] = await this.runSingleAccountTask(config, roundCount);
        } catch (error) {
          results[index] = {
            success: false,
            accountIndex: config.index,
            accountTag: `账号${config.index}[执行异常]`,
            error: `并发执行异常: ${error.message}`,
            initialCoins: 0,
            initialBalance: 0,
            finalCoins: 0,
            finalBalance: 0
          };
          console.log(`账号${config.index} 并发执行异常: ${error.message}`);
        }
      }
    };

    // 创建并发任务池
    const taskPool = Array.from({ length: concurrencyLimit }, () => executeAccountTask());
    await Promise.all(taskPool);

    return results;
  }

  /**
   * 生成总体任务统计
   * @param {Array<Object>} accountResults - 所有账号执行结果
   * @returns {Object} 总体统计数据
   */
  static generateOverallStats(accountResults) {
    const overallStats = {};

    // 初始化所有任务类型的统计
    Object.keys(CONSTANTS.TASK_CONFIGS).forEach(taskKey => {
      overallStats[taskKey] = {
        success: 0,
        failed: 0,
        totalReward: 0
      };
    });

    // 汇总各账号统计数据
    accountResults.forEach(result => {
      if (result.success && result.stats) {
        Object.entries(result.stats).forEach(([taskKey, taskStats]) => {
          if (overallStats[taskKey]) {
            overallStats[taskKey].success += taskStats.success || 0;
            overallStats[taskKey].failed += taskStats.failed || 0;
            overallStats[taskKey].totalReward += taskStats.totalReward || 0;
          }
        });
      }
    });

    return overallStats;
  }

  /**
   * 打印总体任务统计
   * @param {Object} overallStats - 总体统计数据
   */
  static printOverallStats(overallStats) {
    console.log("\n================== 总体任务统计 ==================");
    
    Object.entries(overallStats).forEach(([taskKey, stats]) => {
      const taskConfig = CONSTANTS.TASK_CONFIGS[taskKey];
      const taskName = taskConfig ? taskConfig.name : taskKey;
      const total = stats.success + stats.failed;
      const successRate = total > 0 ? ((stats.success / total) * 100).toFixed(1) : "0.0";
      
      console.log(`- ${taskName}:`);
      console.log(`  总执行: ${total}次, 成功: ${stats.success}次, 失败: ${stats.failed}次, 成功率: ${successRate}%`);
      console.log(`  总奖励: ${stats.totalReward}金币`);
    });
  }

   /**
   * 打印账号金币和余额表格
   * @param {Array<Object>} accountResults - 所有账号执行结果
   */
  static printAccountBalanceTable(accountResults) {
    console.log("\n================== 账号最终结果 ==================");
    
    let maxTagLength = "账号标识".length;
    let maxCoinsLength = "当前金币".length;
    let maxBalanceLength = "当前余额".length;
    
    accountResults.forEach(result => {
      if (result.success) {
        maxTagLength = Math.max(maxTagLength, result.accountTag.length, 10);
        maxCoinsLength = Math.max(maxCoinsLength, result.finalCoins.toString().length, 6);
        maxBalanceLength = Math.max(maxBalanceLength, result.finalBalance.toString().length, 6);
      }
    });
    
    const formatCell = (content, width, align = 'left') => {
      const str = String(content);
      if (str.length > width) {
        return str.substring(0, width - 2) + '..';
      }
      if (align === 'right') {
        return str.padStart(width);
      }
      return str.padEnd(width);
    };
    
    const line = `+${'-'.repeat(maxTagLength + 2)}+${'-'.repeat(maxCoinsLength + 2)}+${'-'.repeat(maxBalanceLength + 2)}+`;
    
    console.log(line);
    console.log(`| ${formatCell('账号标识', maxTagLength)} | ${formatCell('当前金币', maxCoinsLength, 'right')} | ${formatCell('当前余额', maxBalanceLength, 'right')} |`);
    console.log(line);
    
    accountResults.forEach(result => {
      if (result.success) {
        console.log(`| ${formatCell(result.accountTag, maxTagLength)} | ${formatCell(result.finalCoins, maxCoinsLength, 'right')} | ${formatCell(result.finalBalance, maxBalanceLength, 'right')} |`);
      }
    });
    
    console.log(line);
  }
}

class VersionChecker {
  /**
   * 检查版本更新（对比本地与远端版本）
   * @returns {Promise<void>}
   */
  static async checkVersionUpdate() {
    try {
      const requestOptions = {
        method: "get",
        url: CONSTANTS.VERSION_CHECK_URL,
        headers: {
          "User-Agent": CONSTANTS.DEFAULT_USER_AGENT
        }
      };

      // 发起版本检查请求
      const response = await RequestClient.makeRequest(requestOptions);
      if (!response || typeof response !== "object") {
        console.log("版本检查失败：无响应，请进q群：789855292");
        return;
      }

      // 解析远端版本信息
      const appName = response.name || CONSTANTS.APP_NAME;
      const latestVersion = response.latest_version || "";
      const releaseNotes = response.release_notes || "";
      const extraNotes = response.notes || "";

      if (!latestVersion) {
        console.log("版本检查失败：缺少 latest_version 字段");
        return;
      }

      // 对比版本号
      const versionCompareResult = Toolkit.compareVersion(
        CONSTANTS.CURRENT_VERSION,
        latestVersion
      );

      // 输出版本对比结果
      if (versionCompareResult < 0) {
        console.log(`${appName} 发现新版本 v${latestVersion}（当前 v${CONSTANTS.CURRENT_VERSION}）`);
        if (releaseNotes) console.log(`更新说明: ${releaseNotes}`);
        console.log(`\n程序需要更新到最新版本${latestVersion}才能继续使用！`);
        console.log('请更新程序后再运行。');
        process.exit(1); // 停止程序运行
      } else if (versionCompareResult > 0) {
        console.log(`${appName} 当前版本 v${CONSTANTS.CURRENT_VERSION} 新于远端 v${latestVersion}`);
      } else {
        console.log(`${appName} 已是最新版本 v${CONSTANTS.CURRENT_VERSION}`);
      }

      // 输出额外说明
      if (extraNotes) {
        console.log(extraNotes);
        console.log('');
      }
    } catch (error) {
      console.log(`版本检查异常：连接失败，请检查网络或稍后重试，请进q群：789855292`);
    }
  }
}

// 8. 程序入口：初始化、依赖检查、任务启动
async function startKuaishouTask() {
  // 打印启动标识
  console.log("\n================== 快手极速版启动11.11 ==================\n");

  try {
    // 1. 检查必需依赖
    checkRequiredDependencies();
    // 2. 获取活跃公告
    //await VersionChecker.checkVersionUpdate();

    // 3. 获取并验证ksck环境变量（账号配置）
    const ksckValues = Toolkit.getEnv("ksck");
    if (!ksckValues.length) {
      console.log("未找到 ksck 账号环境变量，请检查环境变量");
      console.log("青龙面板格式要求：");
      console.log("1. 完整格式：备注#ck#salt#kaw#kas#代理配置");
      console.log("2. 简化格式（没有kaw和kas）：备注#ck#salt#代理配置");
      console.log("代理配置格式: 地址|端口|账户|密码 或 地址:端口");
      return;
    }

    // 4. 获取金币阈值（从环境变量或使用默认值）
    const minCoinThresholdEnv = Toolkit.getEnv("MIN_COIN_THRESHOLD")[0];
    const minCoinThreshold = minCoinThresholdEnv ? parseInt(minCoinThresholdEnv, 10) : CONSTANTS.DEFAULT_MIN_COIN_THRESHOLD;
    
    // 验证金币阈值是否有效
    if (isNaN(minCoinThreshold) || minCoinThreshold < 0) {
      console.log(`金币阈值设置无效: ${minCoinThresholdEnv}，使用默认值 ${CONSTANTS.DEFAULT_MIN_COIN_THRESHOLD}`);
      minCoinThreshold = CONSTANTS.DEFAULT_MIN_COIN_THRESHOLD;
    }

    // 5. 初始化账号配置
    const accountConfigs = AccountTaskManager.initAccountConfigs(ksckValues, minCoinThreshold);
    if (accountConfigs.length === 0) {
      console.log("未解析到有效账号，程序退出");
      return;
    }

    // 6. 获取配置参数（并发数、任务轮次）
    const maxConcurrency = parseInt(Toolkit.getEnv("ksjsb_xc")[0] || Toolkit.getEnv("ksjsb_xc")[0] || CONSTANTS.ksjsb_xc, 10) || CONSTANTS.ksjsb_xc;
    const taskRounds = parseInt(Toolkit.getEnv("TASK_ROUNDS")[0] || "10", 10) || 10;

    // 7. 打印运行配置
    console.log(`\n运行配置：`);
    console.log(`- 最大并发账号数: ${maxConcurrency}`);
    console.log(`- 每账号任务轮次: ${taskRounds}`);
    console.log(`- 初始金币阈值: ${minCoinThreshold}（达到或超过此值将停止任务）`);
    console.log("ksck账号环境变量，格式为:");
    console.log("1. 完整格式：备注#ck#salt#kaw#kas#代理配置");
    console.log("2. 简化格式（没有kaw和kas）：备注#ck#salt#代理配置");
    console.log("代理配置格式: 地址|端口|账户|密码 或 地址:端口");
    console.log("多账号用换行符分隔，不要有空格");

    // 8. 多账号并发执行任务
    const accountResults = await AccountTaskManager.runConcurrentAccountTasks(
      accountConfigs,
      taskRounds,
      maxConcurrency
    );

    // 9. 生成并打印总体统计
    const overallStats = AccountTaskManager.generateOverallStats(accountResults);
    AccountTaskManager.printOverallStats(overallStats);

    // 10. 打印账号金币和余额表格
    AccountTaskManager.printAccountBalanceTable(accountResults);

    // 11. 程序正常退出
    process.exit(0);
  } catch (error) {
    console.log("程序执行异常:", error.message);
    process.exit(1);
  }
}

// 初始化日志实例（兼容原逻辑）
const taskLogger = new TaskLogger(CONSTANTS.TASK_LOGGER_NAME);

// 启动程序（自执行异步函数）
(async () => {
  try {
    await startKuaishouTask();
  } catch (error) {
    console.log("初始化失败，", error);
  } finally {
    taskLogger.done();
  }
})().catch(error => console.log(error));

// 导出模块（兼容原API调用）
module.exports = {
  runAccountTask: AccountTaskManager.runSingleAccountTask,
  KuaishouAdTaskWorker: KuaishouAdTaskWorker,
  getRandomDelay: Toolkit.getRandomDelay,
  makeRequest: RequestClient.makeRequest,
  parseProxyConfig: Toolkit.parseProxyConfig
};
