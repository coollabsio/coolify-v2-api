import type { FastifyPluginAsync } from 'fastify';
import cuid from 'cuid';
import { githubAPI } from '$lib/common';
import Settings from '$models/Settings';
import User from '$models/User';
import mongoose from 'mongoose';
import jsonwebtoken from 'jsonwebtoken';
import fetch from 'node-fetch'

interface GithubLogin {
  code: string;
}
const route: FastifyPluginAsync = async (fastify, options) => {
  fastify.get('/login/verify', async (request, reply) => {
    try {
      const { authorization } = request.headers
      if (!authorization) {
        return reply.code(401).send({})

      }
      const token = authorization.split(' ')[1]
      const verify: any = jsonwebtoken.verify(token, fastify.config.JWT_SIGN_KEY)
      const found = await User.findOne({ uid: verify.jti })
      found ? reply.code(200).send({}) : reply.code(401).send({})
    } catch (error) {
      reply.code(401).send({})
    }
  });
  fastify.get<{ Querystring: GithubLogin }>('/login/github', async (request, reply) => {
    const { code } = request.query
    try {
      let uid = cuid();
      const { access_token } = await (
        await fetch(
          `https://github.com/login/oauth/access_token?client_id=${fastify.config.VITE_GITHUB_APP_CLIENTID}&client_secret=${fastify.config.GITHUB_APP_CLIENT_SECRET}&code=${code}`,
          { headers: { accept: 'application/json' } }
        )
      ).json();
      const { avatar_url } = await (await githubAPI(request, '/user', access_token)).body;
      const email = (await githubAPI(request, '/user/emails', access_token)).body.filter(
        (e) => e.primary
      )[0].email;

      const settings = await Settings.findOne({ applicationName: 'coolify' });
      const registeredUsers = await User.find().countDocuments();
      const foundUser = await User.findOne({ email });
      if (foundUser) {
        await User.findOneAndUpdate({ email }, { avatar: avatar_url }, { upsert: true, new: true });
        uid = foundUser.uid;
      } else {
        if (registeredUsers === 0) {
          const newUser = new User({
            _id: new mongoose.Types.ObjectId(),
            email,
            avatar: avatar_url,
            uid,
            type: 'github'
          });
          const defaultSettings = new Settings({
            _id: new mongoose.Types.ObjectId()
          });
          try {
            await newUser.save();
            await defaultSettings.save();
          } catch (error) {
            throw new Error(error.message || error)
          }
        } else {
          if (!settings && registeredUsers > 0) {
            throw new Error('Registration disabled, enable it in settings.')
          } else {
            if (!settings.allowRegistration) {
              throw new Error('You shall not pass!')
            } else {
              const newUser = new User({
                _id: new mongoose.Types.ObjectId(),
                email,
                avatar: avatar_url,
                uid,
                type: 'github'
              });
              try {
                await newUser.save();
              } catch (error) {
                throw new Error(error.message || error)
              }
            }
          }
        }
      }
      const coolToken = jsonwebtoken.sign({}, fastify.config.JWT_SIGN_KEY, {
        expiresIn: 15778800,
        algorithm: 'HS256',
        audience: 'coolLabs',
        issuer: 'coolLabs',
        jwtid: uid,
        subject: `User:${uid}`,
        notBefore: -1000
      });
      reply
        .code(200)
        .redirect(
          302,
          `${request.headers.referer}success?coolToken=${coolToken}&ghToken=${access_token}`
        )
    } catch (error) {
     throw new Error(error.message || error)
    }
  });
  // fastify.get('/login/success', async (request, reply) => {
  //   return reply.sendFile('bye.html')
  // })
};

export default route;
