const Graph = require("graph-data-structure");
const underscore = require('underscore');
const readline = require('readline-sync');
const Input = require('prompt-input');
const fs = require('fs');
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

const port = process.env.PORT || 3000;
const FILE = 'data.json';

let data = false;

try{
    data = fs.readFileSync(FILE, 'utf8');
}catch(e){}

const graph = Graph();

if (data) {
    graph.deserialize(JSON.parse(data));
}

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
    if (!graph.adjacent(u).includes(v)){
        graph.addEdge(u, v, weight);
    }else{
        graph.setEdgeWeight(u, v, weight + graph.getEdgeWeight(u, v));
    }
}



function toNodes(question) {
    const nQuestion = question.replace(/[,\?\.]/, '').toLowerCase();
    const nodes = nQuestion.split(' ').map(n => encodeNode('t', n));
    return nodes;
}

const addQuestion = question => {
    const nodes = toNodes(question);
    nodes.map(graph.addNode);
    for(let i = 1 ; i < nodes.length; i++){
        graph.addAccEdge(nodes[i-1], nodes[i]);
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
    //console.log('a', a);

    const intersection = (arrA, arrB) => arrA.filter(x => arrB.includes(x));

    const n = a.reduce(intersection, a[0]);
    
    const as = n.map(decodeNode).filter(e => e.type == 'a');

    //console.log('D', question, as.map( e => e.value));

    return as.length === 0 ? false : as[0].value;
}

addAnswer('Qual seu nome?', 'David');
// answer('Quantos anos você tem?');
// answer('Qual seu sobrenome?');
// answer('Você tem filhos?');

//console.log(answer('Qual seu nome?'));
//console.log(answer('Você tem filhos?'));

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
    
            (async () => fs.writeFileSync(FILE, JSON.stringify(graph.serialize())))();
        }
    }
} else {
    
    app.use('/', express.static('public'));

    io.on('connection', function(socket){
        console.log('connected');
        socket.on('chat message', function(msg){
            if(!msg || msg === '') return;
            socket.emit('chat message', `me: ${msg}`);

            if(!socket.question){
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
            }else {
                const question = socket.question;
                const newAnswer = msg;

                delete socket.question;
                if (newAnswer === ':!') {
                    socket.emit('chat message', 'bot: Você desativou minha aprendizagem...');
                    return;
                }
                addAnswer(question, newAnswer);
                
                socket.emit('chat message', 'bot: Obrigado por me ensinar!!!');
        
                (async () => fs.writeFileSync(FILE, JSON.stringify(graph.serialize())))();
            }

            
        });
    });
      
    http.listen(port, function(){
        console.log('listening on *:' + port);
    });
}

//fs.writeFileSync(FILE, JSON.stringify(graph.serialize()));

//console.log('Thank YOU!');

//console.log(graph.serialize());



