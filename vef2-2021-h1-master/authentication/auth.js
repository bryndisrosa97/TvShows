import express from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import { Strategy, ExtractJwt } from 'passport-jwt';

import {
  validateUser,
  comparePasswords,
  findByUsername,
  findById,
  createUser,
} from './users.js';

import {
  isNotEmptyString,
  toPositiveNumberOrDefault,
} from '../utils/validation.js';
import { catchErrors } from '../utils/catchErrors.js';

export const authApp = express();
authApp.use(express.json());

const defaultTokenLifetime = 60 * 60 * 24 * 7; // 7 dagar
const secret = '12345';

const {
  JWT_SECRET: jwtSecret = secret,
  JWT_TOKEN_LIFETIME: tokenLifetimeFromEnv,
} = process.env;

const tokenLifetime = toPositiveNumberOrDefault(
  tokenLifetimeFromEnv,
  defaultTokenLifetime,
);

const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: jwtSecret,
};

async function strat(data, next) {
  const user = await findById(data.id);

  if (user) {
    next(null, user);
  } else {
    next(null, false);
  }
}

passport.use(new Strategy(jwtOptions, strat));

authApp.use(passport.initialize());

export function requireAuth(req, res, next) {
  return passport.authenticate(
    'jwt',
    { session: false },
    (err, user, info) => {
      if (err) {
        return next(err);
      }

      if (!user) {
        const error = info && info.name === 'TokenExpiredError'
          ? 'expired token' : 'invalid token';
        return res.status(401).json({ error });
      }

      req.user = user;
      return next();
    },
  )(req, res, next);
}

export function checkUserIsAdmin(req, res, next) {
  if (req.user && req.user.admin) {
    return next();
  }

  return res.status(403).json({ error: 'Forbidden' });
}

async function registerRoute(req, res) {
  const { username, password, email } = req.body;

  const validationMessage = await validateUser({ username, password, email });

  if (validationMessage.length > 0) {
    return res.status(400).json({ errors: validationMessage });
  }

  const result = await createUser(username, password, email);

  delete result.password;

  return res.status(201).json(result);
}

async function loginRoute(req, res) {
  const { username, password } = req.body;

  const validations = [];

  if (!isNotEmptyString(username)) {
    validations.push({
      field: 'username',
      error: 'Username is required',
    });
  }

  if (!isNotEmptyString(password)) {
    validations.push({
      field: 'password',
      error: 'Password is required',
    });
  }

  if (validations.length > 0) {
    return res.status(401).json(validations);
  }
  const user = await findByUsername(username);

  if (!user) {
    return res.status(401).json({ error: 'No such user' });
  }

  const passwordIsCorrect = await comparePasswords(password, user.password);

  if (passwordIsCorrect) {
    const payload = { id: user.id };
    const tokenOptions = { expiresIn: Number(tokenLifetime) };
    const token = jwt.sign(payload, jwtOptions.secretOrKey, tokenOptions);

    delete user.password;

    return res.json({
      user,
      token,
      expiresIn: Number(tokenLifetime),
    });
  }

  return res.status(401).json({ error: 'Invalid password' });
}

authApp.post('/users/register', catchErrors(registerRoute));
authApp.post('/users/login', catchErrors(loginRoute));
