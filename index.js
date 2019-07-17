const Graph = require('graph-data-structure');
const readline = require('readline-sync');
const fs = require('fs');
const express = require('express');
const redis = require('redis');

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

const port = process.env.PORT || 3000;
const { OFFLINE } = process.env;

const FILE = 'data.json';

let data = false;

const graph = Graph();

let redisClient;

function loadData(offline = OFFLINE) {
  console.log('loadData', offline);
  if (!offline) {
    redisClient = redis.createClient(process.env.REDIS_URL);
    redisClient.on('connect', () => {
      console.log('Redis client connected');
      redisClient.get('data', (err, d) => {
        if (err) {
          console.error('Erro ao ler dados do redis');
          process.exit(-1);
        }
        // console.log('load d', d);
        if (d) {
          graph.deserialize(JSON.parse(d));
        }
      });
    });
    redisClient.on('error', (err) => {
      console.error(`Something went wrong on redis connection ${err}`);
      if (process.env.NODE_ENV !== 'production') {
        console.log('Entrando no modo OFFLINE...');
        loadData(true);
        redisClient.end(false);
      }
    });
  }
  if (offline) {
    try {
      data = fs.readFileSync(FILE, 'utf8');
    } catch (e) {
      console.error('Erro ao ler dados do arquivo');
      process.exit(-1);
    }
    if (data) {
      graph.deserialize(JSON.parse(data));
    }
  }
}

const writeData = async (offline = OFFLINE) => {
  const d = JSON.stringify(graph.serialize());

  if (!offline) {
    // console.log('write d', d);

    redisClient.set('data', d, (err) => {
      if (err) {
        console.error('Erro ao gravar dados no redis');
        process.exit(-1);
      }
    });
  }
  if (offline) {
    fs.writeFileSync(FILE, d);
  }
};

loadData();

const encodeNode = (t, k) => `${t}:${k}`;
const decodeNode = (e) => {
  const p = e.split(':');
  return {
    type: p[0],
    value: p[1],
  };
};

graph.removeNode(encodeNode('a', ':!'));

graph.addAccEdge = (u, v, weight = 1) => {
  if (!graph.adjacent(u).includes(v)) {
    graph.addEdge(u, v, weight);
  } else {
    graph.setEdgeWeight(u, v, weight + graph.getEdgeWeight(u, v));
  }
};



function toNodes(question) {
  const nQuestion = question.replace(/[,?.]/, '').toLowerCase();
  const nodes = nQuestion.split(' ').map(n => encodeNode('t', n));
  return nodes;
}

const addQuestion = question => {
  const nodes = toNodes(question);
  nodes.map(graph.addNode);
  for (let i = 1; i < nodes.length; i++) {
    graph.addAccEdge(nodes[i - 1], nodes[i]);
  }
  return nodes;
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
}

const answer = (question) => {
  const qNodes = toNodes(question);
  const a = qNodes.map(graph.adjacent);
  // console.log('a', a);

  const intersection = (arrA, arrB) => arrA.filter(x => arrB.includes(x));

  const n = a.reduce(intersection, a[0]);

  const as = n.map(decodeNode).filter(e => e.type == 'a');

  // console.log('D', question, as.map( e => e.value));

  return as.length === 0 ? false : as[0].value;
};

addAnswer('Qual seu nome?', 'David');
// answer('Quantos anos você tem?');
// answer('Qual seu sobrenome?');
// answer('Você tem filhos?');

// console.log(answer('Qual seu nome?'));
// console.log(answer('Você tem filhos?'));

if (process.env.DEVMODE === 'cli') {
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
        continue;
      }
      addAnswer(question, newAnswer);
      console.log('Obrigado por me ensinar!!!');

      writeData();
    }
  }
} else {
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
          delete socket.question;
          socket.emit('chat message', `bot: ${a}`);
        } else {
          socket.question = question;
          socket.emit('chat message', 'bot: Desculpa ainda não sei response isso...');
          socket.emit('chat message', `bot: Como devo responder a '${question}'?`);
        }
      } else {
        const {
          question
        } = socket;
        const newAnswer = msg;

        delete socket.question;
        if (newAnswer === ':!') {
          socket.emit('chat message', 'bot: Você desativou minha aprendizagem...');
          return;
        }
        addAnswer(question, newAnswer);

        socket.emit('chat message', 'bot: Obrigado por me ensinar!!!');

        writeData();
      }
    });
  });

  http.listen(port, () => {
    console.log(`listening on *:${port}`);
  });
}



// fs.writeFileSync(FILE, JSON.stringify(graph.serialize()));

// console.log('Thank YOU!');

// console.log(graph.serialize());
