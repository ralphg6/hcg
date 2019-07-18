const Graph = require('graph-data-structure');
const readline = require('readline-sync');
const fs = require('fs');
const express = require('express');
const redis = require('redis');
const _ = require('underscore');

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

const port = process.env.PORT || 3000;
let {
  OFFLINE,
} = process.env;

let data = false;

const graph = Graph();

let redisClient;

graph.addAccEdge = (u, v, weight) => {
  if (!graph.adjacent(u).includes(v)) {
    graph.addEdge(u, v, weight);
  } else {
    graph.setEdgeWeight(u, v, (weight || 1) + graph.getEdgeWeight(u, v));
  }
};

graph.clearAll = () => {
  graph.nodes().forEach(graph.removeNode);
};

const encodeNode = (t, k) => `${t}:${k}`;
const decodeNode = (e) => {
  const p = e.split(':');
  return {
    type: p[0],
    value: p[1],
  };
};

function toNodes(question) {
  const nQuestion = question.replace(/[,?.!]/g, '').toLowerCase();
  const nodes = nQuestion.split(' ').map(n => encodeNode('t', n));
  return nodes;
}

const addQuestion = question => {
  const nodes = toNodes(question);
  nodes.map(graph.addNode);
  for (let i = 1; i < nodes.length; i += 1) {
    graph.addAccEdge(nodes[i - 1], nodes[i]);
  }
  return nodes;
};

const getData = () => graph.serialize();

const getDataAsString = () => JSON.stringify(getData());

const writeData = async (offline = OFFLINE, tag = 'data') => {
  const d = getDataAsString();

  if (!offline) {
    // console.log('write d', d);
    redisClient.set(tag, d, (err) => {
      if (err) {
        console.error('Erro ao gravar dados no redis');
        process.exit(-1);
      }
    });
  }
  if (offline) {
    fs.writeFileSync(`${tag}.json`, d);
  }
};

const addAnswer = (q, a) => {
  const nodes = addQuestion(q);
  const qNode = encodeNode('q', q);
  graph.addNode(qNode);
  const aNode = encodeNode('a', a);
  graph.addNode(aNode);
  graph.addAccEdge(qNode, aNode);
  nodes.forEach(element => {
    graph.addAccEdge(element, aNode);
  });
  writeData();
};

const backup = () => {
  const tag = `backup_${new Date().getTime()}`;
  writeData(OFFLINE, tag);
};

const adjust = () => {
  const nodes = graph.nodes();
  // console.log('nodes', nodes);
  const questions = {};
  _.uniq(nodes.filter(n => n.startsWith('q:'))).forEach(q => {
    const qlc = q.toLowerCase();
    const answers = questions[qlc] || [];
    questions[qlc] = _.union(answers, _.uniq(graph.adjacent(q)));
  });
  // console.log('questions', questions);
  const newData = {};
  // graph.deserialize({});
  Object.keys(questions).forEach(q => {
    newData[q] = [];
    questions[q].forEach(a => {
      const weight = graph.getEdgeWeight(q, a);

      newData[q].push({
        a,
        weight,
      });

      // console.log(`${q} > ${a} w: ${weight}`);
    });
  });

  // console.log('newData', newData);
  backup();

  graph.clearAll();

  Object.keys(newData).forEach(q => {
    newData[q].forEach(e => {
      addAnswer(decodeNode(q).value, decodeNode(e.a).value);
      graph.setEdgeWeight(q, e.a, e.weight);
    });
  });

  return getData();
};

const postLoad = () => {
  // addAnswer('Qual seu nome?', 'David');
  // addAnswer('Qual seu nome?', 'David');
  // addAnswer('Qual seu nome?', 'David');
  // addAnswer('Qual seu nome?', 'David');
  // addAnswer('Qual seu nome?', 'David');
  // addAnswer('Qual seu nome?', 'David');
};

function loadData(offline = OFFLINE, tag = 'data') {
  OFFLINE = offline;
  console.log('loadData', offline);
  if (!offline) {
    redisClient = redis.createClient(process.env.REDISTOGO_URL);
    redisClient.on('connect', () => {
      console.log('Redis client connected');
      redisClient.get(tag, (err, d) => {
        console.log('redis get', err, d);
        if (err) {
          console.error('Erro ao ler dados do redis');
          process.exit(-1);
        }
        if (d) {
          graph.deserialize(JSON.parse(d));
          postLoad();
        }
      });
    });
    redisClient.on('error', (err) => {
      console.error(`Something went wrong on redis connection ${err}`);
      if (process.env.NODE_ENV !== 'production') {
        console.log('Entrando no modo OFFLINE...');
        redisClient.end(false);
        loadData(true);
      }
    });
  }
  if (offline) {
    const fileName = `${tag}.json`;
    if (fs.existsSync(fileName)) {
      try {
        data = fs.readFileSync(fileName, 'utf8');
      } catch (e) {
        console.error('Erro ao ler dados do arquivo');
        process.exit(-1);
      }
      if (data) {
        graph.deserialize(JSON.parse(data));
      }
    }
    postLoad();
  }
}

loadData();

graph.removeNode(encodeNode('a', ':!'));

const answer = (question) => {
  const qNodes = toNodes(question);
  const a = qNodes.map(graph.adjacent);
  // console.log('a', a);

  const intersection = (arrA, arrB) => arrA.filter(x => arrB.includes(x));

  const n = a.reduce(intersection, a[0]);

  const as = n.map(decodeNode).filter(e => e.type === 'a');

  // console.log('D', question, as.map( e => e.value));

  return as.length === 0 ? false : as[Math.floor(Math.random() * as.length)].value;
};

// answer('Quantos anos você tem?');
// answer('Qual seu sobrenome?');
// answer('Você tem filhos?');

// console.log(answer('Qual seu nome?'));
// console.log(answer('Você tem filhos?'));

if (process.env.DEVMODE === 'cli') {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const question = readline.prompt();

    if (question === ':x') {
      break;
    }

    const a = answer(question);
    if (a) {
      console.log(a);
    } else {
      const newAnswer = readline.question(`Desculpa ainda não sei response isso...\nComo devo responder a '${question}'? `);
      if (newAnswer === ':!') {
        console.log('Você desativou minha aprendizagem...');
        // eslint-disable-next-line no-continue
        continue;
      }
      addAnswer(question, newAnswer);
      console.log('Obrigado por me ensinar!!!');

      writeData();
    }
  }
} else {
  app.get('/data', (req, res) => {
    res.send(getData());
  });

  app.get('/adjust', (req, res) => {
    res.send(adjust());
  });

  app.use('/', express.static('public'));

  io.on('connection', (socket) => {
    console.log('connected');
    socket.on('chat message', (msg) => {
      if (!msg || msg === '') return;
      socket.emit('chat message', `me: ${msg}`);

      if (!socket.question) {
        const question = msg;
        const a = answer(question);
        if (a) {
          // eslint-disable-next-line no-param-reassign
          delete socket.question;
          socket.emit('chat message', `bot: ${a}`);
        } else {
          // eslint-disable-next-line no-param-reassign
          socket.question = question;
          socket.emit('chat message', 'bot: Desculpa ainda não sei response isso...');
          socket.emit('chat message', `bot: Como devo responder a '${question}'?`);
        }
      } else {
        const {
          question,
        } = socket;
        const newAnswer = msg;

        // eslint-disable-next-line no-param-reassign
        delete socket.question;
        if (newAnswer === ':!') {
          socket.emit('chat message', 'bot: Você desativou minha aprendizagem...');
          return;
        }
        addAnswer(question, newAnswer);

        socket.emit('chat message', 'bot: Obrigado por me ensinar!!!');
      }
    });
  });

  http.listen(port, () => {
    console.log(`listening on *:${port}`);
  });
}
